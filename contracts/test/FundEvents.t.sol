// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Vm} from "forge-std/Vm.sol";
import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";

/// The web app and the agent rebuild the timeline from events, so their data has to be exact.
contract FundEventsTest is BaseFundTest {
    function test_usdtContributionEmitsTheUsdtReceivedAndTheWarsCredited() public {
        uint256 credited = fund.quoteUsdtInWars(10e6);
        usdt.mint(members[0], 10e6);
        vm.startPrank(members[0]);
        usdt.approve(address(fund), 10e6);
        vm.expectEmit(address(fund));
        emit Fund.Contribution(members[0], address(usdt), 10e6, credited);
        fund.contributeUsdt(10e6);
        vm.stopPrank();
    }

    function test_proposalCreatedCarriesTheWholeProposal() public {
        vm.expectEmit(address(fund));
        emit Fund.ProposalCreated(0, Fund.Action.Pay, members[1], address(0), 1_000e18, members[0], "pitch deposit");
        vm.prank(members[0]);
        fund.propose(Fund.Action.Pay, members[1], address(0), 1_000e18, "pitch deposit");
    }

    function test_aMemberProposalAlsoCastsTheProposerVote() public {
        vm.expectEmit(address(fund));
        emit Fund.ProposalCreated(0, Fund.Action.Close, address(0), address(0), 0, members[0], "note");
        vm.expectEmit(address(fund));
        emit Fund.VoteCast(0, members[0]);
        _propose(members[0], Fund.Action.Close, address(0), 0);
    }

    function test_anAgentProposalCastsNoVote() public {
        vm.recordLogs();
        vm.prank(agent);
        fund.propose(Fund.Action.Pay, members[1], address(0), 1, "over the weekly cap");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], Fund.ProposalCreated.selector);
    }

    function test_voteEmitsVoteCast() public {
        uint256 id = _propose(members[0], Fund.Action.Close, address(0), 0);
        vm.expectEmit(address(fund));
        emit Fund.VoteCast(id, members[1]);
        vm.prank(members[1]);
        fund.vote(id);
    }

    function test_executingAPaymentEmitsPaymentThenProposalExecuted() public {
        _contributeWars(members[0], 5_000e18);
        uint256 id = _propose(members[0], Fund.Action.Pay, members[1], 1_000e18);
        _castVotes(id, 1, 3);
        vm.expectEmit(address(fund));
        emit Fund.Payment(members[1], 1_000e18);
        vm.expectEmit(address(fund));
        emit Fund.ProposalExecuted(id);
        fund.execute(id);
    }
}
