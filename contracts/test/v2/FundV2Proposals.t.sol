// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";

contract FundV2ProposalsTest is BaseFundV2Test {
    // ---------------------------------------------------------------- Proposal limits
    function test_tenProposalsPerWeekThenReverts() public {
        for (uint256 i; i < 10; ++i) {
            _propose(members[0], FundV2.Action.SetWeeklyCap, address(0), address(0), 1);
        }
        assertEq(fund.proposalsInWeek(0, members[0]), 10);
        assertEq(fund.proposalCount(), 10);

        vm.prank(members[0]);
        vm.expectRevert(FundV2.TooManyProposals.selector);
        fund.propose(FundV2.Action.SetWeeklyCap, address(0), address(0), 1, "note");
        assertEq(fund.proposalCount(), 10);
    }

    function test_proposalLimitIsPerProposer() public {
        for (uint256 i; i < 10; ++i) {
            _propose(members[0], FundV2.Action.SetWeeklyCap, address(0), address(0), 1);
        }
        // Another member, and the agent, have their own count.
        _propose(members[1], FundV2.Action.SetWeeklyCap, address(0), address(0), 1);
        _propose(agent, FundV2.Action.SetWeeklyCap, address(0), address(0), 1);
        assertEq(fund.proposalsInWeek(0, members[1]), 1);
        assertEq(fund.proposalsInWeek(0, agent), 1);
        assertEq(fund.proposalCount(), 12);
    }

    function test_proposalLimitResetsNextWeek() public {
        for (uint256 i; i < 10; ++i) {
            _propose(agent, FundV2.Action.SetWeeklyCap, address(0), address(0), 1);
        }
        vm.prank(agent);
        vm.expectRevert(FundV2.TooManyProposals.selector);
        fund.propose(FundV2.Action.SetWeeklyCap, address(0), address(0), 1, "note");

        vm.warp(fund.startTime() + fund.WEEK());
        assertEq(fund.currentWeek(), 1);
        _propose(agent, FundV2.Action.SetWeeklyCap, address(0), address(0), 1);
        assertEq(fund.proposalsInWeek(1, agent), 1);
        assertEq(fund.proposalsInWeek(0, agent), 10);
    }

    function test_outsiderCannotPropose() public {
        uint256 week = fund.currentWeek();
        vm.prank(outsider);
        vm.expectRevert(FundV2.OnlyMemberOrAgent.selector);
        fund.propose(FundV2.Action.SetWeeklyCap, address(0), address(0), 1, "note");
        assertEq(fund.proposalsInWeek(week, outsider), 0);
        assertEq(fund.proposalCount(), 0);
    }

    function test_noteUpTo560Bytes() public {
        bytes memory ok = new bytes(560);
        for (uint256 i; i < ok.length; ++i) {
            ok[i] = "a";
        }
        vm.prank(members[0]);
        uint256 id = fund.propose(FundV2.Action.SetWeeklyCap, address(0), address(0), 1, string(ok));
        assertEq(bytes(fund.getProposal(id).note).length, 560);

        bytes memory tooLong = new bytes(561);
        for (uint256 i; i < tooLong.length; ++i) {
            tooLong[i] = "a";
        }
        vm.prank(members[0]);
        vm.expectRevert(FundV2.NoteTooLong.selector);
        fund.propose(FundV2.Action.SetWeeklyCap, address(0), address(0), 1, string(tooLong));
        assertEq(fund.proposalCount(), 1);
    }

    // ---------------------------------------------------------------- SetAgent
    function test_setAgentRejectsZeroFundAndMember() public {
        address[3] memory bad = [address(0), address(fund), members[1]];
        for (uint256 i; i < bad.length; ++i) {
            uint256 id = _propose(members[0], FundV2.Action.SetAgent, bad[i], address(0), 0);
            _castVotes(id);
            vm.expectRevert(FundV2.InvalidParams.selector);
            fund.execute(id);
            assertEq(fund.agent(), agent);
        }
    }

    function test_setAgentChangesAgent() public {
        address newAgent = makeAddr("newAgent");
        uint256 id = _propose(members[0], FundV2.Action.SetAgent, newAgent, address(0), 0);
        _castVotes(id);
        vm.expectEmit(true, false, false, false, address(fund));
        emit FundV2.AgentChanged(newAgent);
        fund.execute(id);
        assertEq(fund.agent(), newAgent);
    }

    // ---------------------------------------------------------------- SetWeeklyCap
    function test_setWeeklyCapUpToBalanceCap() public {
        uint256 id = _propose(members[0], FundV2.Action.SetWeeklyCap, address(0), address(0), BALANCE_CAP);
        _castVotes(id);
        vm.expectEmit(false, false, false, true, address(fund));
        emit FundV2.WeeklyCapChanged(BALANCE_CAP);
        fund.execute(id);
        assertEq(fund.weeklyCap(), BALANCE_CAP);

        id = _propose(members[0], FundV2.Action.SetWeeklyCap, address(0), address(0), BALANCE_CAP + 1);
        _castVotes(id);
        vm.expectRevert(FundV2.InvalidParams.selector);
        fund.execute(id);
        assertEq(fund.weeklyCap(), BALANCE_CAP);
    }

    // ---------------------------------------------------------------- Voting and expiry, as v1
    function test_votingAndExpiryAsV1() public {
        uint256 id = _propose(members[0], FundV2.Action.SetWeeklyCap, address(0), address(0), 1_000e18);
        assertEq(fund.voteCount(id), 1, "the proposer's vote is counted");

        vm.prank(members[0]);
        vm.expectRevert(FundV2.AlreadyVoted.selector);
        fund.vote(id);

        vm.expectRevert(FundV2.NotEnoughVotes.selector);
        fund.execute(id);

        _castVotes(id);
        fund.execute(id);
        assertEq(fund.weeklyCap(), 1_000e18);

        vm.expectRevert(FundV2.ProposalAlreadyExecuted.selector);
        fund.execute(id);
        vm.prank(members[4]);
        vm.expectRevert(FundV2.ProposalAlreadyExecuted.selector);
        fund.vote(id);

        uint256 late = _propose(members[0], FundV2.Action.SetWeeklyCap, address(0), address(0), 2_000e18);
        vm.warp(block.timestamp + fund.PROPOSAL_DURATION() + 1);
        vm.prank(members[1]);
        vm.expectRevert(FundV2.ProposalExpired.selector);
        fund.vote(late);
        vm.expectRevert(FundV2.ProposalExpired.selector);
        fund.execute(late);
    }
}
