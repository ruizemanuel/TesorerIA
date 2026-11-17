// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {FundV2} from "../../src/FundV2.sol";
import {FundFactoryV2} from "../../src/FundFactoryV2.sol";
import {MockPool} from "../mocks/MockPool.sol";

/// Runs against a local fork of Celo mainnet (created by `setUp`): `forge test --match-path "test/fork/FundV2Fork.t.sol" -vv`.
/// Nothing is sent to the real network: the fork is a local EVM that only reads Celo's state.
contract FundV2ForkTest is Test {
    IUniswapV3Factory constant UNISWAP_FACTORY = IUniswapV3Factory(0xAfE208a311B21f13EF87E33A90049fC17A7acDEc);
    address constant FEE_RECIPIENT = 0x5Dc9C76C6999C6C604b3D91C040D17b125ca4581;

    IERC20 constant WARS = IERC20(0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D);
    IERC20 constant USDT = IERC20(0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e);
    IUniswapV3Pool constant WARS_POOL = IUniswapV3Pool(0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391);
    IERC20 constant WMXN = IERC20(0x337E7456B420bD3481e7FA61fA9850343d610d34);
    IERC20 constant WBRL = IERC20(0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0);
    IUniswapV3Pool constant WBRL_POOL = IUniswapV3Pool(0x01c3cf91cdf7B34181C7eC8566c0236951FEA40F);

    uint16 constant FEE_BPS = 25;

    FundFactoryV2 factory;
    address agent = makeAddr("agent");
    address[] members;

    function setUp() public {
        // Without the network (a sandbox, a plane), there's no Celo to fork: the suite is skipped, not failed, so a plain
        // `forge test` passes offline. The unit, fuzz and invariant tests cover the contracts with mocks.
        try vm.createSelectFork(vm.rpcUrl("celo")) {}
        catch {
            vm.skip(true, "no network to fork Celo mainnet");
            return;
        }
        for (uint256 i; i < 3; ++i) {
            members.push(makeAddr(string.concat("member", vm.toString(i))));
        }
        factory = new FundFactoryV2(UNISWAP_FACTORY, FEE_RECIPIENT);
    }

    function _params(IERC20 currency, IERC20 dollar, IUniswapV3Pool pool)
        internal
        view
        returns (FundV2.Params memory p)
    {
        p.name = "Fork";
        p.members = members;
        p.votesRequired = 2;
        p.agent = agent;
        p.agreedExpense = "Pitch";
        p.weeklyCap = 60_000e18;
        p.balanceCap = 2_000_000e18;
        p.currency = currency;
        p.dollar = dollar;
        p.pool = pool;
        p.feeBps = FEE_BPS;
    }

    /// The pool has plenty of USDT: on the fork, it "lends" them to the members.
    function _give(IERC20 token, address to, uint256 amount) internal {
        vm.prank(address(WARS_POOL));
        token.transfer(to, amount);
    }

    function test_warsFundConvertsAgainstTheRealPool() public {
        FundV2 fund = FundV2(factory.createFund(_params(WARS, USDT, WARS_POOL)));
        address m = members[0];

        // The TWAP prices a dollar at a sane number of wARS (as in v1's fork test).
        uint256 oneDollar = fund.quoteDollar(1e6);
        assertGt(oneDollar, 1_000e18);
        assertLt(oneDollar, 3_000e18);

        _give(USDT, m, 300e6);
        vm.startPrank(m);
        USDT.approve(address(fund), 300e6);
        fund.contributeDollar(300e6);
        vm.stopPrank();
        // A dollar contribution is only pending: nothing is credited until the agent converts it.
        assertEq(fund.pendingDollar(m), 300e6);
        assertEq(fund.totalPendingDollar(), 300e6);
        assertEq(fund.contributed(m), 0);
        assertEq(USDT.balanceOf(address(fund)), 300e6);

        address[] memory who = new address[](1);
        who[0] = m;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 300e6;
        uint256 expected = fund.quoteDollar(300e6);
        vm.prank(agent);
        uint256 received = fund.convert(who, amounts, expected * 9_950 / 10_000);

        uint256 fee = received * FEE_BPS / 10_000;
        assertApproxEqRel(received, expected, 0.01e18);
        assertEq(fund.contributed(m), received - fee);
        assertEq(fund.totalContributed(), received - fee);
        assertEq(fund.feeOwed(), fee);
        assertEq(fund.pendingDollar(m), 0);
        assertEq(fund.totalPendingDollar(), 0);
        assertEq(USDT.balanceOf(address(fund)), 0);
        assertEq(WARS.balanceOf(address(fund)), received);
        assertEq(fund.availableCurrency(), received - fee);
    }

    function test_wmxnFundWithoutDollar() public {
        FundV2.Params memory p = _params(WMXN, IERC20(address(0)), IUniswapV3Pool(address(0)));
        p.weeklyCap = 1_000e18;
        p.balanceCap = 100_000e18;
        FundV2 fund = FundV2(factory.createFund(p));
        address m = members[0];

        deal(address(WMXN), m, 1_000e18);
        assertEq(WMXN.balanceOf(m), 1_000e18);
        vm.startPrank(m);
        WMXN.approve(address(fund), 1_000e18);
        fund.contribute(1_000e18);
        vm.stopPrank();

        uint256 contribution = 1_000e18;
        uint256 fee = contribution * FEE_BPS / 10_000;
        uint256 net = contribution - fee;
        assertEq(fund.contributed(m), net);
        assertEq(fund.feeOwed(), fee);
        assertEq(WMXN.balanceOf(address(fund)), 1_000e18);
        assertEq(fund.availableCurrency(), net);
        // With no dollar the fund never reads a pool, and takes no dollar contribution.
        assertEq(fund.balanceInCurrency(), net);
        vm.prank(m);
        vm.expectRevert(FundV2.NoDollar.selector);
        fund.contributeDollar(1);
    }

    /// wBRL's pool is the real one for (wBRL, USDT) at its fee tier and it serves a TWAP: the contract accepts it. Whether
    /// the agent ever uses it is decided later, off-chain.
    function test_wbrlFundCanBeCreatedWithItsPool() public {
        FundV2 fund = FundV2(factory.createFund(_params(WBRL, USDT, WBRL_POOL)));
        assertEq(address(fund.currency()), address(WBRL));
        assertEq(address(fund.dollar()), address(USDT));
        assertEq(address(fund.pool()), address(WBRL_POOL));
        assertEq(factory.fundCount(), 1);
        assertEq(factory.funds(0), address(fund));
    }

    /// A pool that is not the one Uniswap's factory has for (wARS, USDT) is rejected, even if it looks like it.
    function test_rejectsAPoolThatIsNotUniswaps() public {
        MockPool fake = new MockPool(address(WARS), address(USDT), -350142);
        vm.expectRevert(FundFactoryV2.InvalidPool.selector);
        factory.createFund(_params(WARS, USDT, IUniswapV3Pool(address(fake))));
        assertEq(factory.fundCount(), 0);
    }

    /// What `createFund` costs with the real factory and the real pool, for the bundler (plan B): measured with the
    /// pool cold, as it is on the first call of a transaction.
    function test_createFundGas() public {
        FundV2.Params memory p = _params(WARS, USDT, WARS_POOL);
        uint256 gasBefore = gasleft();
        factory.createFund(p);
        uint256 gasUsed = gasBefore - gasleft();
        console.log("createFund gas:", gasUsed);
        assertLt(gasUsed, 10_000_000);
    }
}
