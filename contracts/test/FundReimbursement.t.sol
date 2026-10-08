// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";

contract FundReimbursementTest is BaseFundTest {
    bytes32 constant REF = keccak256("expense-1");

    function setUp() public override {
        super.setUp();
        _contributeWars(members[1], 200_000e18);
    }

    function test_reimbursesWithinTheCap() public {
        vm.expectEmit(true, false, false, true, address(fund));
        emit Fund.Reimbursement(members[0], 45_000e18, REF, 0);
        vm.prank(agent);
        fund.reimburseAgreedExpense(members[0], 45_000e18, REF);
        assertEq(wars.balanceOf(members[0]), 45_000e18);
        assertEq(fund.spentInWeek(0), 45_000e18);
    }

    function test_exceedingTheWeeklyCapReverts() public {
        vm.startPrank(agent);
        fund.reimburseAgreedExpense(members[0], 45_000e18, REF);
        vm.expectRevert(Fund.WeeklyCapExceeded.selector);
        fund.reimburseAgreedExpense(members[2], 15_001e18, REF);
        vm.stopPrank();
    }

    function test_capResetsTheNextWeek() public {
        vm.prank(agent);
        fund.reimburseAgreedExpense(members[0], 60_000e18, REF);
        vm.warp(fund.startTime() + 7 days);
        vm.prank(agent);
        fund.reimburseAgreedExpense(members[0], 60_000e18, REF);
        assertEq(fund.spentInWeek(0), 60_000e18);
        assertEq(fund.spentInWeek(1), 60_000e18);
    }

    function test_onlyToMembers() public {
        vm.prank(agent);
        vm.expectRevert(Fund.RecipientNotMember.selector);
        fund.reimburseAgreedExpense(outsider, 1e18, REF);
    }

    function test_onlyTheAgent() public {
        vm.prank(members[0]);
        vm.expectRevert(Fund.OnlyAgent.selector);
        fund.reimburseAgreedExpense(members[0], 1e18, REF);
    }

    function test_revertsWithoutWarsBalance() public {
        Fund empty = _newFund(_params());
        vm.prank(agent);
        vm.expectRevert(Fund.InsufficientBalance.selector);
        empty.reimburseAgreedExpense(members[0], 1e18, REF);
    }

    function testFuzz_weeklyTotalNeverExceedsTheCap(uint256[6] memory amounts) public {
        uint256 sum;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 m = bound(amounts[i], 1, 30_000e18);
            vm.prank(agent);
            if (sum + m > WEEKLY_CAP) {
                vm.expectRevert(Fund.WeeklyCapExceeded.selector);
                fund.reimburseAgreedExpense(members[0], m, REF);
            } else {
                fund.reimburseAgreedExpense(members[0], m, REF);
                sum += m;
            }
        }
        assertLe(fund.spentInWeek(0), WEEKLY_CAP);
        assertEq(fund.spentInWeek(0), sum);
    }
}
