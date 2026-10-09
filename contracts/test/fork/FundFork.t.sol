// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {Fund} from "../../src/Fund.sol";
import {FundFactory} from "../../src/FundFactory.sol";

/// Runs against a local fork of Celo mainnet (created by `setUp`): `forge test --match-path "test/fork/*" -vv`.
/// With `FACTORY=<address>` it runs on the factory deployed on mainnet instead of a fresh one.
contract FundForkTest is Test {
    IERC20 constant WARS = IERC20(0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D);
    IERC20 constant USDT = IERC20(0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e);
    IUniswapV3Pool constant POOL = IUniswapV3Pool(0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391);

    Fund fund;
    address agent = makeAddr("agent");
    address[] members;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("celo"));
        for (uint256 i; i < 3; ++i) members.push(makeAddr(string.concat("member", vm.toString(i))));
        FundFactory factory = _factory();
        Fund.Params memory p;
        p.name = "Fork";
        p.members = members;
        p.votesRequired = 2;
        p.agent = agent;
        p.agreedExpense = "Pitch";
        p.weeklyCap = 60_000e18;
        p.balanceCap = 2_000_000e18;
        fund = Fund(factory.createFund(p));
    }

    function _factory() internal returns (FundFactory) {
        address deployed = vm.envOr("FACTORY", address(0));
        if (deployed == address(0)) return new FundFactory(WARS, USDT, POOL);
        return FundFactory(deployed);
    }

    /// The deployed factory runs exactly this repo's code: same bytecode and immutables as a fresh build.
    function test_deployedFactoryMatchesTheSource() public {
        address deployed = vm.envOr("FACTORY", address(0));
        vm.skip(deployed == address(0));
        assertEq(deployed.code, address(new FundFactory(WARS, USDT, POOL)).code);
    }

    /// The pool has plenty of USDT and wARS: on the fork, it "lends" them to the members.
    function _give(IERC20 token, address to, uint256 amount) internal {
        vm.prank(address(POOL));
        token.transfer(to, amount);
    }

    function test_twapGivesAReasonablePrice() public view {
        uint256 q = fund.quoteUsdtInWars(1e6);
        assertGt(q, 1_000e18);
        assertLt(q, 3_000e18);
    }

    function test_contributeUsdtAndConvertAgainstTheRealPool() public {
        _give(USDT, members[0], 300e6);
        vm.startPrank(members[0]);
        USDT.approve(address(fund), 300e6);
        fund.contributeUsdt(300e6);
        vm.stopPrank();
        uint256 credited = fund.contributed(members[0]);
        assertApproxEqRel(credited, fund.quoteUsdtInWars(300e6), 0.0001e18);

        uint256 expected = fund.quoteUsdtInWars(300e6);
        vm.prank(agent);
        uint256 received = fund.convert(300e6, expected * 99 / 100);
        assertApproxEqRel(received, expected, 0.01e18);
        assertEq(USDT.balanceOf(address(fund)), 0);
        assertEq(WARS.balanceOf(address(fund)), received);
    }

    function test_smallConversionOf5Usdt() public {
        _give(USDT, members[1], 5e6);
        vm.startPrank(members[1]);
        USDT.approve(address(fund), 5e6);
        fund.contributeUsdt(5e6);
        vm.stopPrank();
        uint256 expected = fund.quoteUsdtInWars(5e6);
        vm.prank(agent);
        uint256 received = fund.convert(5e6, expected * 99 / 100);
        assertApproxEqRel(received, expected, 0.01e18);
    }

    function test_contributeWarsAndReimburse() public {
        _give(WARS, members[2], 50_000e18);
        vm.startPrank(members[2]);
        WARS.approve(address(fund), 50_000e18);
        fund.contributeWars(50_000e18);
        vm.stopPrank();
        vm.prank(agent);
        fund.reimburseAgreedExpense(members[0], 45_000e18, keccak256("pitch"));
        assertEq(WARS.balanceOf(members[0]), 45_000e18);
    }

    /// Closing through the fund's governance, and then splitting what arrives later, pay out the real tokens
    /// in proportion to what each member contributed. Only rounding dust stays in the fund.
    function test_closeAndDistributeRemainderPayOutTheRealTokens() public {
        // Uneven shares: member 0 puts in wARS only, member 1 wARS and USDT, member 2 nothing.
        _give(WARS, members[0], 100_000e18);
        _give(WARS, members[1], 30_000e18);
        _give(USDT, members[1], 100e6);
        vm.startPrank(members[0]);
        WARS.approve(address(fund), 100_000e18);
        fund.contributeWars(100_000e18);
        vm.stopPrank();
        vm.startPrank(members[1]);
        WARS.approve(address(fund), 30_000e18);
        fund.contributeWars(30_000e18);
        USDT.approve(address(fund), 100e6);
        fund.contributeUsdt(100e6);
        vm.stopPrank();
        assertGt(fund.contributed(members[1]), fund.contributed(members[0]));
        assertGt(fund.contributed(members[0]), 0);
        assertEq(fund.contributed(members[2]), 0);
        assertGt(USDT.balanceOf(address(fund)), 0);

        // Close: a member proposes (and votes), a second member votes, anyone executes.
        vm.prank(members[0]);
        uint256 id = fund.propose(Fund.Action.Close, address(0), address(0), 0, "close the fund");
        vm.prank(members[1]);
        fund.vote(id);

        uint256[] memory warsBefore = _balancesOf(WARS);
        uint256[] memory usdtBefore = _balancesOf(USDT);
        uint256[] memory warsShares = _sharesOf(WARS);
        uint256[] memory usdtShares = _sharesOf(USDT);
        fund.execute(id);
        assertTrue(fund.closed());
        _assertPaid(WARS, warsBefore, warsShares);
        _assertPaid(USDT, usdtBefore, usdtShares);
        assertLt(WARS.balanceOf(address(fund)), fund.members().length);
        assertLt(USDT.balanceOf(address(fund)), fund.members().length);

        // Later, real wARS and USDT reach the closed fund (an exchange withdrawal in transit): a non-member splits them.
        _give(WARS, address(fund), 7_777e18 + 13);
        _give(USDT, address(fund), 33e6 + 7);
        warsBefore = _balancesOf(WARS);
        usdtBefore = _balancesOf(USDT);
        warsShares = _sharesOf(WARS);
        usdtShares = _sharesOf(USDT);
        vm.prank(makeAddr("stranger"));
        fund.distributeRemainder();
        _assertPaid(WARS, warsBefore, warsShares);
        _assertPaid(USDT, usdtBefore, usdtShares);
        assertLt(WARS.balanceOf(address(fund)), fund.members().length);
        assertLt(USDT.balanceOf(address(fund)), fund.members().length);

        // The member who never contributed got nothing, and the other two got a real payout.
        assertEq(WARS.balanceOf(members[2]), 0);
        assertEq(USDT.balanceOf(members[2]), 0);
        assertGt(WARS.balanceOf(members[0]), 0);
        assertGt(WARS.balanceOf(members[1]), 0);
        assertGt(USDT.balanceOf(members[1]), 0);
    }

    function _balancesOf(IERC20 token) private view returns (uint256[] memory b) {
        b = new uint256[](members.length);
        for (uint256 i; i < members.length; ++i) b[i] = token.balanceOf(members[i]);
    }

    /// What each member should get from the fund's current balance of `token`: balance * contributed / total.
    function _sharesOf(IERC20 token) private view returns (uint256[] memory s) {
        s = new uint256[](members.length);
        uint256 balance = token.balanceOf(address(fund));
        for (uint256 i; i < members.length; ++i) {
            s[i] = balance * fund.contributed(members[i]) / fund.totalContributed();
        }
    }

    /// Each member's balance of `token` rose by the expected share, within 1 wei of rounding.
    function _assertPaid(IERC20 token, uint256[] memory before, uint256[] memory shares) private view {
        for (uint256 i; i < members.length; ++i) {
            assertApproxEqAbs(token.balanceOf(members[i]) - before[i], shares[i], 1);
        }
    }
}
