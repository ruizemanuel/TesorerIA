// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";

contract FundGovernanceTest is BaseFundTest {
    address newcomer = makeAddr("newcomer");

    function setUp() public override {
        super.setUp();
        _contributeWars(members[0], 30_000e18);
        _contributeWars(members[1], 10_000e18);
        _contributeUsdt(members[1], 10e6); // ≈ 16,058.8 wARS
    }

    function _pass(Fund.Action action, address a, address b, uint256 amount) internal returns (uint256 id) {
        id = _propose(members[0], action, a, b, amount);
        _castVotes(id, 1, 3);
        fund.execute(id);
    }

    /// The member list holds exactly these addresses, in any order.
    function _assertMembers(address[] memory expected) internal view {
        address[] memory list = fund.members();
        assertEq(list.length, expected.length);
        for (uint256 i; i < expected.length; ++i) {
            bool found;
            for (uint256 j; j < list.length; ++j) {
                if (list[j] == expected[i]) found = true;
            }
            assertTrue(found, "a member is missing from the list");
        }
    }

    function test_addMember() public {
        _pass(Fund.Action.AddMember, newcomer, address(0), 0);
        assertTrue(fund.isMember(newcomer));
        assertEq(fund.members().length, 6);
        assertEq(fund.contributed(newcomer), 0);
    }

    function test_cannotAddTheAgentOrAMember() public {
        uint256 id = _propose(members[0], Fund.Action.AddMember, agent, address(0), 0);
        _castVotes(id, 1, 3);
        vm.expectRevert(Fund.InvalidParams.selector);
        fund.execute(id);
        id = _propose(members[0], Fund.Action.AddMember, members[2], address(0), 0);
        _castVotes(id, 1, 3);
        vm.expectRevert(Fund.InvalidParams.selector);
        fund.execute(id);
    }

    function test_removeMemberReturnsTheirShare() public {
        uint256 totalBefore = fund.totalContributed();
        uint256 contributionM1 = fund.contributed(members[1]);
        uint256 warsExpected = wars.balanceOf(address(fund)) * contributionM1 / totalBefore;
        uint256 usdtExpected = usdt.balanceOf(address(fund)) * contributionM1 / totalBefore;
        _pass(Fund.Action.RemoveMember, members[1], address(0), 0);
        assertFalse(fund.isMember(members[1]));
        assertEq(fund.members().length, 4);
        assertEq(wars.balanceOf(members[1]), warsExpected);
        assertEq(usdt.balanceOf(members[1]), usdtExpected);
        assertEq(fund.contributed(members[1]), 0);
        assertEq(fund.totalContributed(), totalBefore - contributionM1);
    }

    // Final review: removing a member from the middle leaves the other four in the list (the last one too), and
    // the last one's vote still counts.
    function test_removingAMemberFromTheMiddleUpdatesTheList() public {
        _pass(Fund.Action.RemoveMember, members[2], address(0), 0);
        address[] memory expected = new address[](4);
        expected[0] = members[0];
        expected[1] = members[1];
        expected[2] = members[3];
        expected[3] = members[4];
        _assertMembers(expected);

        uint256 payment = _propose(members[0], Fund.Action.Pay, members[1], 1_000e18);
        vm.prank(members[4]);
        fund.vote(payment);
        assertEq(fund.voteCount(payment), 2);
        vm.prank(members[2]);
        vm.expectRevert(Fund.NotMember.selector);
        fund.vote(payment);
        _castVotes(payment, 3, 4);
        fund.execute(payment);
        assertEq(wars.balanceOf(members[1]), 1_000e18);
    }

    function test_cannotRemoveIfNWouldExceedTheMembers() public {
        _pass(Fund.Action.SetVotesRequired, address(0), address(0), 5);
        uint256 id = _propose(members[0], Fund.Action.RemoveMember, members[4], address(0), 0);
        _castVotes(id, 1, 5);
        vm.expectRevert(Fund.InvalidParams.selector);
        fund.execute(id);
    }

    function test_replaceMemberMovesTheContribution() public {
        uint256 contribution = fund.contributed(members[0]);
        _pass(Fund.Action.ReplaceMember, members[0], newcomer, 0);
        assertFalse(fund.isMember(members[0]));
        assertTrue(fund.isMember(newcomer));
        assertEq(fund.contributed(newcomer), contribution);
        assertEq(fund.contributed(members[0]), 0);
        assertEq(fund.members().length, 5);
    }

    // Final review: the newcomer takes the old member's spot in the list, votes and is counted; the old one can't vote.
    function test_replaceMemberSwapsTheListEntryAndTheNewcomerVotes() public {
        _pass(Fund.Action.ReplaceMember, members[2], newcomer, 0);
        address[] memory expected = new address[](5);
        expected[0] = members[0];
        expected[1] = members[1];
        expected[2] = newcomer;
        expected[3] = members[3];
        expected[4] = members[4];
        _assertMembers(expected);

        uint256 payment = _propose(members[0], Fund.Action.Pay, newcomer, 1_000e18);
        vm.prank(members[2]);
        vm.expectRevert(Fund.NotMember.selector);
        fund.vote(payment);
        _castVotes(payment, 1, 2);
        vm.prank(newcomer);
        fund.vote(payment);
        assertEq(fund.voteCount(payment), 3);
        fund.execute(payment);
        assertEq(wars.balanceOf(newcomer), 1_000e18);
    }

    function test_setWeeklyCap() public {
        _pass(Fund.Action.SetWeeklyCap, address(0), address(0), 80_000e18);
        assertEq(fund.weeklyCap(), 80_000e18);
    }

    function test_setVotesRequiredOutOfRangeReverts() public {
        uint256 id = _propose(members[0], Fund.Action.SetVotesRequired, address(0), address(0), 1);
        _castVotes(id, 1, 3);
        vm.expectRevert(Fund.InvalidParams.selector);
        fund.execute(id);
    }

    // Review Focus 4: execution uses the current N.
    function test_executeUsesTheCurrentVotesRequired() public {
        uint256 payment = _propose(members[0], Fund.Action.Pay, members[2], 1_000e18);
        _castVotes(payment, 1, 3); // 3 votes: enough with N = 3
        _pass(Fund.Action.SetVotesRequired, address(0), address(0), 4);
        vm.expectRevert(Fund.NotEnoughVotes.selector);
        fund.execute(payment);
        _castVotes(payment, 3, 4);
        fund.execute(payment);
        assertEq(wars.balanceOf(members[2]), 1_000e18);
    }

    // Review Focus 2: if the recipient is no longer a member, the payment reverts.
    function test_paymentToARemovedMemberReverts() public {
        uint256 payment = _propose(members[0], Fund.Action.Pay, members[2], 1_000e18);
        _castVotes(payment, 1, 2);
        _pass(Fund.Action.RemoveMember, members[2], address(0), 0);
        _castVotes(payment, 3, 4);
        vm.expectRevert(Fund.RecipientNotMember.selector);
        fund.execute(payment);
    }

    // Review Focus 5: once the agent is fired, its functions revert and the group keeps operating.
    function test_firedAgentCannotOperate() public {
        _pass(Fund.Action.SetAgent, address(0), address(0), 0);
        assertEq(fund.agent(), address(0));
        vm.prank(agent);
        vm.expectRevert(Fund.OnlyAgent.selector);
        fund.reimburseAgreedExpense(members[0], 1e18, bytes32(0));
        vm.prank(agent);
        vm.expectRevert(Fund.OnlyAgent.selector);
        fund.convert(1e6, 1);
        vm.prank(agent);
        vm.expectRevert(Fund.OnlyMemberOrAgent.selector);
        fund.propose(Fund.Action.Pay, members[0], address(0), 1e18, "x");
        _pass(Fund.Action.Pay, members[3], address(0), 1_000e18);
        assertEq(wars.balanceOf(members[3]), 1_000e18);
    }

    function test_replaceAgent() public {
        _pass(Fund.Action.SetAgent, newcomer, address(0), 0);
        assertEq(fund.agent(), newcomer);
        vm.prank(newcomer);
        fund.reimburseAgreedExpense(members[0], 1_000e18, bytes32(0));
    }

    function test_theNewAgentCannotBeAMember() public {
        uint256 id = _propose(members[0], Fund.Action.SetAgent, members[3], address(0), 0);
        _castVotes(id, 1, 3);
        vm.expectRevert(Fund.InvalidParams.selector);
        fund.execute(id);
    }
}
