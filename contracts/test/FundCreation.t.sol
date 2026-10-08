// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

contract FundCreationTest is BaseFundTest {
    function test_storesTheParams() public view {
        assertEq(fund.name(), "Thursday football");
        assertEq(fund.agreedExpense(), "Pitch");
        assertEq(fund.weeklyCap(), WEEKLY_CAP);
        assertEq(fund.balanceCap(), BALANCE_CAP);
        assertEq(fund.votesRequired(), 3);
        assertEq(fund.agent(), agent);
        assertEq(fund.members().length, 5);
        for (uint256 i; i < 5; ++i) assertTrue(fund.isMember(members[i]));
        assertFalse(fund.isMember(agent));
        assertEq(fund.startTime(), block.timestamp);
        assertFalse(fund.closed());
    }

    function test_quotesWithTheTwap() public view {
        assertApproxEqRel(fund.quoteUsdtInWars(1e6), 1605.88e18, 0.001e18);
        assertEq(fund.quoteUsdtInWars(0), 0);
    }

    function test_twapRoundsDownWithNegativeTick() public {
        assertEq(pool.token0(), address(wars));

        // Offset -1: delta -630255601, quotient -350142.2, rounded down to -350143.
        pool.setCumulativeOffset(-1);
        assertEq(
            fund.quoteUsdtInWars(1e6),
            OracleLibrary.getQuoteAtTick(-350143, 1e6, address(usdt), address(wars))
        );

        // Offset 0: delta -630255600, exactly -350142.
        pool.setCumulativeOffset(0);
        assertEq(
            fund.quoteUsdtInWars(1e6),
            OracleLibrary.getQuoteAtTick(-350142, 1e6, address(usdt), address(wars))
        );

        // Offset +1: delta -630255599, quotient -350141.99, rounded down to -350142.
        pool.setCumulativeOffset(1);
        assertEq(
            fund.quoteUsdtInWars(1e6),
            OracleLibrary.getQuoteAtTick(-350142, 1e6, address(usdt), address(wars))
        );
    }

    function test_weeksAreSevenDayWindows() public {
        assertEq(fund.currentWeek(), 0);
        vm.warp(block.timestamp + 7 days - 1);
        assertEq(fund.currentWeek(), 0);
        vm.warp(block.timestamp + 1);
        assertEq(fund.currentWeek(), 1);
    }

    function test_revertsWithFewerThanThreeMembers() public {
        Fund.Params memory p = _params();
        address[] memory two = new address[](2);
        two[0] = members[0];
        two[1] = members[1];
        p.members = two;
        p.votesRequired = 2;
        vm.expectRevert(Fund.InvalidParams.selector);
        _newFund(p);
    }

    function test_revertsWithMoreThanTenMembers() public {
        Fund.Params memory p = _params();
        address[] memory eleven = new address[](11);
        for (uint256 i; i < 11; ++i) eleven[i] = address(uint160(1000 + i));
        p.members = eleven;
        vm.expectRevert(Fund.InvalidParams.selector);
        _newFund(p);
    }

    function test_revertsWithDuplicateMember() public {
        Fund.Params memory p = _params();
        p.members[4] = p.members[0];
        vm.expectRevert(Fund.InvalidParams.selector);
        _newFund(p);
    }

    function test_revertsWithZeroAddressMember() public {
        Fund.Params memory p = _params();
        p.members[2] = address(0);
        vm.expectRevert(Fund.InvalidParams.selector);
        _newFund(p);
    }

    function test_revertsIfTheAgentIsAMember() public {
        Fund.Params memory p = _params();
        p.agent = members[1];
        vm.expectRevert(Fund.InvalidParams.selector);
        _newFund(p);
    }

    function test_revertsWithVotesOutOfRange() public {
        Fund.Params memory p = _params();
        p.votesRequired = 1;
        vm.expectRevert(Fund.InvalidParams.selector);
        _newFund(p);
        p.votesRequired = 6;
        vm.expectRevert(Fund.InvalidParams.selector);
        _newFund(p);
    }

    function test_revertsWithZeroBalanceCap() public {
        Fund.Params memory p = _params();
        p.balanceCap = 0;
        vm.expectRevert(Fund.InvalidParams.selector);
        _newFund(p);
    }

    function test_revertsIfThePoolIsNotWarsUsdt() public {
        MockERC20 other = new MockERC20("OTHER", "OTHER", 18);
        MockPool bad = new MockPool(address(other), address(usdt), 0);
        vm.expectRevert(Fund.InvalidParams.selector);
        new Fund(IERC20(address(wars)), IERC20(address(usdt)), IUniswapV3Pool(address(bad)), _params());
    }
}
