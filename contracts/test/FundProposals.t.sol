// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";

contract FundProposalsTest is BaseFundTest {
    function setUp() public override {
        super.setUp();
        _contributeWars(members[0], 100_000e18);
    }

    function test_memberProposerVotesAutomatically() public {
        uint256 id = _propose(members[0], Fund.Action.Pay, members[1], 20_000e18);
        assertEq(id, 0);
        assertEq(fund.proposalCount(), 1);
        assertTrue(fund.hasVoted(id, members[0]));
        assertEq(fund.voteCount(id), 1);
    }

    function test_agentCanProposeButNotVote() public {
        uint256 id = _propose(agent, Fund.Action.Pay, members[1], 20_000e18);
        assertEq(fund.voteCount(id), 0);
        vm.prank(agent);
        vm.expectRevert(Fund.NotMember.selector);
        fund.vote(id);
    }

    function test_outsiderCannotPropose() public {
        vm.prank(outsider);
        vm.expectRevert(Fund.OnlyMemberOrAgent.selector);
        fund.propose(Fund.Action.Pay, members[1], address(0), 1e18, "x");
    }

    function test_paymentWithEnoughVotesIsExecuted() public {
        uint256 id = _propose(members[0], Fund.Action.Pay, members[1], 20_000e18);
        _castVotes(id, 1, 3); // members 1 and 2: with the proposer that makes 3
        vm.prank(outsider);
        fund.execute(id);
        assertEq(wars.balanceOf(members[1]), 20_000e18);
        assertTrue(fund.getProposal(id).executed);
    }

    function test_withoutEnoughVotesItIsNotExecuted() public {
        uint256 id = _propose(members[0], Fund.Action.Pay, members[1], 20_000e18);
        _castVotes(id, 1, 2);
        vm.expectRevert(Fund.NotEnoughVotes.selector);
        fund.execute(id);
    }

    function test_cannotVoteTwice() public {
        uint256 id = _propose(members[0], Fund.Action.Pay, members[1], 1e18);
        vm.prank(members[0]);
        vm.expectRevert(Fund.AlreadyVoted.selector);
        fund.vote(id);
    }

    function test_expiredProposalCannotBeVotedOrExecuted() public {
        uint256 id = _propose(members[0], Fund.Action.Pay, members[1], 1e18);
        _castVotes(id, 1, 2);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(members[2]);
        vm.expectRevert(Fund.ProposalExpired.selector);
        fund.vote(id);
        vm.expectRevert(Fund.ProposalExpired.selector);
        fund.execute(id);
    }

    function test_cannotExecuteTwice() public {
        uint256 id = _propose(members[0], Fund.Action.Pay, members[1], 1e18);
        _castVotes(id, 1, 3);
        fund.execute(id);
        vm.expectRevert(Fund.ProposalAlreadyExecuted.selector);
        fund.execute(id);
    }

    function test_paymentToANonMemberRevertsOnExecute() public {
        uint256 id = _propose(members[0], Fund.Action.Pay, outsider, 1e18);
        _castVotes(id, 1, 3);
        vm.expectRevert(Fund.RecipientNotMember.selector);
        fund.execute(id);
    }

    function test_proposalNotFound() public {
        vm.expectRevert(Fund.ProposalNotFound.selector);
        fund.execute(99);
    }
}
