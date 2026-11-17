// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";

contract FundV2PaymentsTest is BaseFundV2Test {
    bytes32 internal constant REF = keccak256("expense-1");

    function setUp() public override {
        super.setUp();
        _contribute(members[1], 200_000e18);
    }

    // ---------------------------------------------------------------- Reimbursement (agent)
    function test_reimburseWithinWeeklyCapFromAvailable() public {
        uint256 availableBefore = fund.availableCurrency();
        vm.expectEmit(true, false, false, true, address(fund));
        emit FundV2.Reimbursement(members[0], 45_000e18, REF, 0);
        vm.prank(agent);
        fund.reimburseAgreedExpense(members[0], 45_000e18, REF);
        assertEq(currency.balanceOf(members[0]), 45_000e18);
        assertEq(fund.spentInWeek(0), 45_000e18);
        assertEq(fund.availableCurrency(), availableBefore - 45_000e18);

        vm.prank(agent);
        vm.expectRevert(FundV2.WeeklyCapExceeded.selector);
        fund.reimburseAgreedExpense(members[2], 15_001e18, REF);

        vm.warp(fund.startTime() + fund.WEEK());
        vm.prank(agent);
        fund.reimburseAgreedExpense(members[2], 15_001e18, REF);
        assertEq(fund.spentInWeek(1), 15_001e18);
    }

    function test_reimburseCannotTouchFeeOwed() public {
        FundV2.Params memory p = _params();
        p.weeklyCap = BALANCE_CAP; // the cap must not be what stops the agent here
        fund = _create(p);
        _contribute(members[0], 10_025e18);
        uint256 owed = fund.feeOwed();
        uint256 available = fund.availableCurrency();
        assertGt(owed, 0);
        assertGe(currency.balanceOf(address(fund)), available + 1, "the raw balance would cover it");

        vm.prank(agent);
        vm.expectRevert(FundV2.InsufficientBalance.selector);
        fund.reimburseAgreedExpense(members[1], available + 1, REF);

        vm.prank(agent);
        fund.reimburseAgreedExpense(members[1], available, REF);
        assertEq(currency.balanceOf(members[1]), available);
        assertEq(currency.balanceOf(address(fund)), owed);
        assertEq(fund.feeOwed(), owed);
        fund.payFee();
        assertEq(currency.balanceOf(feeRecipient), owed);
    }

    function test_reimburseOnlyTheAgentOnlyToMembersNeverZero() public {
        vm.prank(members[0]);
        vm.expectRevert(FundV2.OnlyAgent.selector);
        fund.reimburseAgreedExpense(members[0], 1e18, REF);

        vm.startPrank(agent);
        vm.expectRevert(FundV2.RecipientNotMember.selector);
        fund.reimburseAgreedExpense(outsider, 1e18, REF);
        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.reimburseAgreedExpense(members[0], 0, REF);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- Pay
    function test_payProposalPaysMember() public {
        uint256 id = _propose(members[0], FundV2.Action.Pay, members[1], address(0), 1_000e18);
        _castVotes(id);
        vm.expectEmit(true, false, false, true, address(fund));
        emit FundV2.Payment(members[1], 1_000e18);
        fund.execute(id);
        assertEq(currency.balanceOf(members[1]), 1_000e18);
        assertTrue(fund.getProposal(id).executed);
    }

    function test_payToNonMemberReverts() public {
        uint256 id = _propose(members[0], FundV2.Action.Pay, outsider, address(0), 1_000e18);
        _castVotes(id);
        vm.expectRevert(FundV2.RecipientNotMember.selector);
        fund.execute(id);
        assertEq(currency.balanceOf(outsider), 0);
        assertFalse(fund.getProposal(id).executed);
    }

    function test_payZeroReverts() public {
        uint256 id = _propose(members[0], FundV2.Action.Pay, members[1], address(0), 0);
        _castVotes(id);
        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.execute(id);
        assertFalse(fund.getProposal(id).executed);
    }

    // ---------------------------------------------------------------- GiveBack
    function test_giveBackPaysAndLowersContributed() public {
        _contribute(members[0], 100_000e18);
        uint256 contributedBefore = fund.contributed(members[0]);
        uint256 totalBefore = fund.totalContributed();
        assertEq(contributedBefore, _net(100_000e18));
        assertEq(currency.balanceOf(members[0]), 0);

        uint256 id = _propose(members[0], FundV2.Action.GiveBack, members[0], address(0), 10_000e18);
        _castVotes(id);
        vm.expectEmit(true, false, false, true, address(fund));
        emit FundV2.ContributionGivenBack(members[0], 10_000e18);
        fund.execute(id);

        assertEq(currency.balanceOf(members[0]), 10_000e18);
        assertEq(fund.contributed(members[0]), contributedBefore - 10_000e18);
        assertEq(fund.totalContributed(), totalBefore - 10_000e18);
    }

    function test_giveBackAboveContributedReverts() public {
        _contribute(members[0], 100_000e18);
        uint256 id =
            _propose(members[0], FundV2.Action.GiveBack, members[0], address(0), fund.contributed(members[0]) + 1);
        _castVotes(id);
        vm.expectRevert(FundV2.GiveBackTooLarge.selector);
        fund.execute(id);

        // Everything contributed can be given back.
        id = _propose(members[0], FundV2.Action.GiveBack, members[0], address(0), fund.contributed(members[0]));
        _pass(id);
        assertEq(fund.contributed(members[0]), 0);
    }

    function test_giveBackToNonMemberReverts() public {
        uint256 id = _propose(members[0], FundV2.Action.GiveBack, outsider, address(0), 1e18);
        _castVotes(id);
        vm.expectRevert(FundV2.RecipientNotMember.selector);
        fund.execute(id);
    }

    function test_giveBackZeroReverts() public {
        _contribute(members[0], 100_000e18);
        uint256 id = _propose(members[0], FundV2.Action.GiveBack, members[0], address(0), 0);
        _castVotes(id);
        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.execute(id);
    }

    function test_payAndGiveBackCannotTouchFeeOwed() public {
        fund = _create(_params());
        _contribute(members[0], 10_025e18);
        vm.prank(agent);
        fund.reimburseAgreedExpense(members[1], 10e18, REF);
        uint256 contributedByMember = fund.contributed(members[0]);
        uint256 available = fund.availableCurrency();
        assertGt(fund.feeOwed(), 10e18);
        assertGe(currency.balanceOf(address(fund)), contributedByMember, "the raw balance would cover all of it");

        uint256 id = _propose(members[0], FundV2.Action.Pay, members[1], address(0), available + 1);
        _castVotes(id);
        vm.expectRevert(FundV2.InsufficientBalance.selector);
        fund.execute(id);

        id = _propose(members[0], FundV2.Action.GiveBack, members[0], address(0), contributedByMember);
        _castVotes(id);
        vm.expectRevert(FundV2.InsufficientBalance.selector);
        fund.execute(id);
    }

    function test_agentCanProposeGiveBack() public {
        _contribute(members[0], 100_000e18);
        uint256 id = _propose(agent, FundV2.Action.GiveBack, members[0], address(0), 10_000e18);
        assertEq(fund.voteCount(id), 0);
        assertFalse(fund.hasVoted(id, agent));
        assertEq(fund.getProposal(id).proposer, agent);

        vm.prank(agent);
        vm.expectRevert(FundV2.NotMember.selector);
        fund.vote(id);

        _pass(id);
        assertEq(currency.balanceOf(members[0]), 10_000e18);
        assertEq(fund.contributed(members[0]), _net(100_000e18) - 10_000e18);
    }
}
