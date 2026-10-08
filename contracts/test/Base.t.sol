// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {Fund} from "../src/Fund.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPool} from "./mocks/MockPool.sol";

abstract contract BaseFundTest is Test {
    MockERC20 internal wars;
    MockERC20 internal usdt;
    MockPool internal pool;
    Fund internal fund;

    address internal agent = makeAddr("agent");
    address internal outsider = makeAddr("outsider");
    address[] internal members;

    uint256 internal constant WEEKLY_CAP = 60_000e18;
    uint256 internal constant BALANCE_CAP = 450_000e18;

    function setUp() public virtual {
        usdt = new MockERC20("USDT", "USDT", 6);
        wars = new MockERC20("wARS", "wARS", 18);
        require(address(wars) < address(usdt), "wARS must be token0, as on Celo");
        // The real pool's orientation: token0 = wARS, tick -350142.
        int24 tick = -350142;
        pool = new MockPool(address(wars), address(usdt), tick);
        wars.mint(address(pool), 1_000_000_000e18);
        usdt.mint(address(pool), 1_000_000e6);
        for (uint256 i; i < 5; ++i) {
            members.push(makeAddr(string.concat("member", vm.toString(i))));
        }
        fund = _newFund(_params());
    }

    function _params() internal view returns (Fund.Params memory p) {
        p.name = "Thursday football";
        p.members = members;
        p.votesRequired = 3;
        p.agent = agent;
        p.agreedExpense = "Pitch";
        p.weeklyCap = WEEKLY_CAP;
        p.balanceCap = BALANCE_CAP;
    }

    function _newFund(Fund.Params memory p) internal returns (Fund) {
        return new Fund(IERC20(address(wars)), IERC20(address(usdt)), IUniswapV3Pool(address(pool)), p);
    }

    function _contributeWars(address m, uint256 amount) internal {
        wars.mint(m, amount);
        vm.startPrank(m);
        wars.approve(address(fund), amount);
        fund.contributeWars(amount);
        vm.stopPrank();
    }

    function _contributeUsdt(address m, uint256 amount) internal {
        usdt.mint(m, amount);
        vm.startPrank(m);
        usdt.approve(address(fund), amount);
        fund.contributeUsdt(amount);
        vm.stopPrank();
    }

    function _propose(address who, Fund.Action action, address a, address b, uint256 amount)
        internal
        returns (uint256 id)
    {
        vm.prank(who);
        id = fund.propose(action, a, b, amount, "note");
    }

    function _propose(address who, Fund.Action action, address a, uint256 amount) internal returns (uint256) {
        return _propose(who, action, a, address(0), amount);
    }

    function _castVotes(uint256 id, uint256 from, uint256 to) internal {
        for (uint256 i = from; i < to; ++i) {
            vm.prank(members[i]);
            fund.vote(id);
        }
    }
}
