// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {FundV2} from "../../src/FundV2.sol";
import {FundFactoryV2} from "../../src/FundFactoryV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {MockUniswapV3Factory} from "../mocks/MockUniswapV3Factory.sol";

abstract contract BaseFundV2Test is Test {
    MockERC20 internal currency;
    MockERC20 internal dollar;
    MockPool internal pool;
    MockUniswapV3Factory internal uniFactory;
    FundFactoryV2 internal factory;
    FundV2 internal fund;

    address internal agent = makeAddr("agent");
    address internal outsider = makeAddr("outsider");
    address internal feeRecipient = makeAddr("feeRecipient");
    address[] internal members;

    uint256 internal constant WEEKLY_CAP = 60_000e18;
    uint256 internal constant BALANCE_CAP = 450_000e18;
    uint16 internal constant FEE_BPS = 25;

    function setUp() public virtual {
        dollar = new MockERC20("USDT", "USDT", 6);
        currency = new MockERC20("wARS", "wARS", 18);
        require(address(currency) < address(dollar), "currency must be token0, as wARS is on Celo");
        // The real wARS/USDT pool's orientation: token0 = wARS, tick -350142.
        int24 tick = -350142;
        pool = new MockPool(address(currency), address(dollar), tick);
        currency.mint(address(pool), 1_000_000_000e18);
        dollar.mint(address(pool), 1_000_000e6);
        uniFactory = new MockUniswapV3Factory();
        uniFactory.setPool(address(currency), address(dollar), pool.fee(), address(pool));
        factory = new FundFactoryV2(IUniswapV3Factory(address(uniFactory)), feeRecipient);
        for (uint256 i; i < 5; ++i) {
            members.push(makeAddr(string.concat("member", vm.toString(i))));
        }
        fund = _create(_params());
    }

    function _params() internal view returns (FundV2.Params memory p) {
        p.name = "Thursday football";
        p.members = members;
        p.votesRequired = 3;
        p.agent = agent;
        p.agreedExpense = "Pitch";
        p.weeklyCap = WEEKLY_CAP;
        p.balanceCap = BALANCE_CAP;
        p.currency = IERC20(address(currency));
        p.dollar = IERC20(address(dollar));
        p.pool = IUniswapV3Pool(address(pool));
        p.feeBps = FEE_BPS;
    }

    /// A fund with no dollar entry: no dollar and no pool.
    function _paramsNoDollar() internal view returns (FundV2.Params memory p) {
        p = _params();
        p.dollar = IERC20(address(0));
        p.pool = IUniswapV3Pool(address(0));
    }

    function _create(FundV2.Params memory p) internal returns (FundV2) {
        return FundV2(factory.createFund(p));
    }

    /// What a contribution of `amount` credits after the default fee (`FEE_BPS`).
    function _net(uint256 amount) internal pure returns (uint256) {
        return amount - amount * FEE_BPS / 10_000;
    }

    /// `m` contributes `amount` of the currency to `fund`, minted for the occasion.
    function _contribute(address m, uint256 amount) internal {
        currency.mint(m, amount);
        vm.startPrank(m);
        currency.approve(address(fund), amount);
        fund.contribute(amount);
        vm.stopPrank();
    }

    /// `m` contributes `amount` of the dollar to `fund`, minted for the occasion. It stays pending until converted.
    function _contributeDollar(address m, uint256 amount) internal {
        dollar.mint(m, amount);
        vm.startPrank(m);
        dollar.approve(address(fund), amount);
        fund.contributeDollar(amount);
        vm.stopPrank();
    }

    /// `who` proposes `action` on `fund`; a member proposer votes for it too, the agent does not.
    function _propose(address who, FundV2.Action action, address a, address b, uint256 amount)
        internal
        returns (uint256 id)
    {
        vm.prank(who);
        id = fund.propose(action, a, b, amount, "note");
    }

    /// The members who haven't voted on `id` vote until it has `votesRequired` votes.
    function _castVotes(uint256 id) internal {
        address[] memory current = fund.members();
        for (uint256 i; i < current.length && fund.voteCount(id) < fund.votesRequired(); ++i) {
            if (fund.hasVoted(id, current[i])) continue;
            vm.prank(current[i]);
            fund.vote(id);
        }
    }

    /// Votes `id` through (see `_castVotes`) and executes it.
    function _pass(uint256 id) internal {
        _castVotes(id);
        fund.execute(id);
    }
}
