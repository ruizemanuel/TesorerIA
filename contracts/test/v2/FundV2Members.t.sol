// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";

contract FundV2MembersTest is BaseFundV2Test {
    address internal newcomer = makeAddr("newcomer");

    /// Proposes `action` as members[0], votes it through and executes it.
    function _passAs0(FundV2.Action action, address a, address b) internal {
        _pass(_propose(members[0], action, a, b, 0));
    }

    /// Proposes `action` as members[1] and votes it through, then expects the execution to revert with `err`.
    function _expectExecuteReverts(FundV2.Action action, address a, address b, bytes4 err) internal {
        uint256 id = _propose(members[1], action, a, b, 0);
        _castVotes(id);
        vm.expectRevert(err);
        fund.execute(id);
    }

    // ---------------------------------------------------------------- Removal with pending dollars
    function test_removeReturnsShareOfAvailableAndAllOwnPending() public {
        _contribute(members[0], 100_000e18);
        _contribute(members[1], 50_000e18);
        _contributeDollar(members[0], 30e6);
        _contributeDollar(members[1], 20e6);
        dollar.mint(address(fund), 10e6); // a stray dollar, sent straight to the fund: no member's
        uint256 share = fund.availableCurrency() * fund.contributed(members[0]) / fund.totalContributed();
        uint256 totalBefore = fund.totalContributed();
        uint256 contributedBefore = fund.contributed(members[0]);
        uint256 feeOwedBefore = fund.feeOwed();
        assertGt(share, 0);

        uint256 id = _propose(members[1], FundV2.Action.RemoveMember, members[0], address(0), 0);
        _castVotes(id);
        vm.expectEmit(true, false, false, true, address(fund));
        emit FundV2.MemberRemoved(members[0], share, 30e6);
        fund.execute(id);

        assertFalse(fund.isMember(members[0]));
        assertEq(currency.balanceOf(members[0]), share);
        assertEq(dollar.balanceOf(members[0]), 30e6, "all its own pending dollars, and not a share of the stray one");
        assertEq(dollar.balanceOf(address(fund)), 20e6 + 10e6);
        assertEq(fund.pendingDollar(members[0]), 0);
        assertEq(fund.totalPendingDollar(), 20e6);
        assertEq(fund.pendingDollar(members[1]), 20e6);
        assertEq(fund.contributed(members[0]), 0);
        assertEq(fund.totalContributed(), totalBefore - contributedBefore);
        assertEq(fund.feeOwed(), feeOwedBefore);
    }

    function test_removeMemberWithOnlyPendingDollarsGetsNoCurrency() public {
        _contribute(members[1], 50_000e18);
        _contributeDollar(members[0], 30e6);
        uint256 id = _propose(members[1], FundV2.Action.RemoveMember, members[0], address(0), 0);
        _castVotes(id);
        vm.expectEmit(true, false, false, true, address(fund));
        emit FundV2.MemberRemoved(members[0], 0, 30e6);
        fund.execute(id);
        assertEq(currency.balanceOf(members[0]), 0);
        assertEq(dollar.balanceOf(members[0]), 30e6);
        assertEq(fund.totalPendingDollar(), 0);
    }

    function test_removeFromNoDollarFundNeverCallsTheDollar() public {
        fund = _create(_paramsNoDollar());
        _contribute(members[0], 100_000e18);
        uint256 share = fund.availableCurrency();
        uint256 id = _propose(members[1], FundV2.Action.RemoveMember, members[0], address(0), 0);
        _castVotes(id);
        vm.expectEmit(true, false, false, true, address(fund));
        emit FundV2.MemberRemoved(members[0], share, 0);
        fund.execute(id);
        assertEq(currency.balanceOf(members[0]), share);
        assertFalse(fund.isMember(members[0]));
    }

    function test_removeNeverPaysFeeOwed() public {
        _contribute(members[0], 100_000e18); // the only contributor: its share is everything the fund can pay
        uint256 owed = fund.feeOwed();
        assertGt(owed, 0);
        assertEq(currency.balanceOf(address(fund)), _net(100_000e18) + owed);

        _passAs0(FundV2.Action.RemoveMember, members[0], address(0));

        assertEq(currency.balanceOf(members[0]), _net(100_000e18));
        assertEq(fund.feeOwed(), owed);
        assertEq(currency.balanceOf(address(fund)), owed, "the fee set aside stays in the fund");
        fund.payFee();
        assertEq(currency.balanceOf(feeRecipient), owed);
        assertEq(fund.feeOwed(), 0);
    }

    function test_removingFromTheMiddleKeepsTheOthersInTheList() public {
        _passAs0(FundV2.Action.RemoveMember, members[1], address(0));
        address[] memory list = fund.members();
        assertEq(list.length, 4);
        assertEq(list[0], members[0]);
        assertEq(list[1], members[4], "the last member takes the freed place");
        assertEq(list[2], members[2]);
        assertEq(list[3], members[3]);
        assertFalse(fund.isMember(members[1]));
    }

    function test_removedMemberCannotBeConverted() public {
        _contributeDollar(members[0], 30e6);
        _contributeDollar(members[1], 20e6);
        _passAs0(FundV2.Action.RemoveMember, members[0], address(0));
        assertEq(fund.pendingDollar(members[0]), 0);

        address[] memory who = new address[](1);
        who[0] = members[0];
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.prank(agent);
        vm.expectRevert(FundV2.InsufficientPending.selector);
        fund.convert(who, amounts, 0);
    }

    // ---------------------------------------------------------------- Replacement
    function test_replaceMovesContributedAndPending() public {
        _contribute(members[0], 100_000e18);
        _contributeDollar(members[0], 30e6);
        uint256 contributedBefore = fund.contributed(members[0]);
        uint256 totalBefore = fund.totalContributed();
        assertGt(contributedBefore, 0);

        uint256 id = _propose(members[1], FundV2.Action.ReplaceMember, members[0], newcomer, 0);
        _castVotes(id);
        vm.expectEmit(true, true, false, false, address(fund));
        emit FundV2.MemberReplaced(members[0], newcomer);
        fund.execute(id);

        assertFalse(fund.isMember(members[0]));
        assertTrue(fund.isMember(newcomer));
        assertEq(fund.contributed(newcomer), contributedBefore);
        assertEq(fund.contributed(members[0]), 0);
        assertEq(fund.pendingDollar(newcomer), 30e6);
        assertEq(fund.pendingDollar(members[0]), 0);
        assertEq(fund.totalContributed(), totalBefore);
        assertEq(fund.totalPendingDollar(), 30e6);
        assertEq(fund.members().length, 5);
        assertEq(fund.members()[0], newcomer, "the newcomer takes the old member's place in the list");
    }

    // ---------------------------------------------------------------- Rules of v1
    function test_addAndReplaceRejectFundAddress() public {
        _expectExecuteReverts(FundV2.Action.AddMember, address(fund), address(0), FundV2.InvalidParams.selector);
        _expectExecuteReverts(FundV2.Action.ReplaceMember, members[0], address(fund), FundV2.InvalidParams.selector);
        assertFalse(fund.isMember(address(fund)));
        assertTrue(fund.isMember(members[0]));
    }

    function test_replaceWithZeroAddressReverts() public {
        _expectExecuteReverts(FundV2.Action.ReplaceMember, members[0], address(0), FundV2.InvalidParams.selector);
        assertTrue(fund.isMember(members[0]));
        assertFalse(fund.isMember(address(0)));
        assertEq(fund.members().length, 5);
    }

    function test_addMemberAddsThemToTheList() public {
        uint256 id = _propose(members[0], FundV2.Action.AddMember, newcomer, address(0), 0);
        _castVotes(id);
        vm.expectEmit(true, false, false, false, address(fund));
        emit FundV2.MemberAdded(newcomer);
        fund.execute(id);
        assertTrue(fund.isMember(newcomer));
        assertEq(fund.members().length, 6);
        assertEq(fund.members()[5], newcomer);
    }

    function test_memberRulesAsV1() public {
        // the agent can't join, nor take a member's place; neither can the zero address or a current member
        _expectExecuteReverts(FundV2.Action.AddMember, agent, address(0), FundV2.InvalidParams.selector);
        _expectExecuteReverts(FundV2.Action.ReplaceMember, members[0], agent, FundV2.InvalidParams.selector);
        _expectExecuteReverts(FundV2.Action.AddMember, address(0), address(0), FundV2.InvalidParams.selector);
        _expectExecuteReverts(FundV2.Action.AddMember, members[1], address(0), FundV2.InvalidParams.selector);
        _expectExecuteReverts(FundV2.Action.ReplaceMember, members[0], members[1], FundV2.InvalidParams.selector);
        _expectExecuteReverts(FundV2.Action.ReplaceMember, outsider, newcomer, FundV2.InvalidParams.selector);

        // only a member can be removed, and a removal has to leave more members than votesRequired (3): with 5
        // members one can go, and the next would leave 3
        _expectExecuteReverts(FundV2.Action.RemoveMember, outsider, address(0), FundV2.InvalidParams.selector);
        _passAs0(FundV2.Action.RemoveMember, members[4], address(0));
        assertEq(fund.members().length, 4);
        _expectExecuteReverts(FundV2.Action.RemoveMember, members[3], address(0), FundV2.InvalidParams.selector);
        assertTrue(fund.isMember(members[3]));

        // at most MAX_MEMBERS (10)
        for (uint256 i; fund.members().length < fund.MAX_MEMBERS(); ++i) {
            _passAs0(FundV2.Action.AddMember, makeAddr(string.concat("extra", vm.toString(i))), address(0));
        }
        assertEq(fund.members().length, 10);
        _expectExecuteReverts(FundV2.Action.AddMember, newcomer, address(0), FundV2.InvalidParams.selector);
        assertFalse(fund.isMember(newcomer));
    }
}
