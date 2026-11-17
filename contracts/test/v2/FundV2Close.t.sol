// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";

contract FundV2CloseTest is BaseFundV2Test {
    /// Members[0] proposes closing the fund and it passes.
    function _closeFund() internal {
        _pass(_propose(members[0], FundV2.Action.Close, address(0), address(0), 0));
    }

    // ---------------------------------------------------------------- Closing
    function test_closePaysPendingThenSplitsByContributed() public {
        _contribute(members[0], 100_000e18);
        _contribute(members[1], 50_000e18);
        _contributeDollar(members[0], 20e6); // pending, and not yet credited to anyone's share
        _contributeDollar(members[2], 15e6); // pending, from a member who contributed no currency
        dollar.mint(address(fund), 10e6); // a stray dollar, sent straight to the fund: no member's
        uint256 available = fund.availableCurrency();
        uint256 total = fund.totalContributed();
        uint256 c0 = fund.contributed(members[0]);
        uint256 c1 = fund.contributed(members[1]);
        assertEq(fund.totalPendingDollar(), 35e6);

        uint256 id = _propose(members[0], FundV2.Action.Close, address(0), address(0), 0);
        _castVotes(id);
        vm.expectEmit(address(fund));
        emit FundV2.FundClosed(available, 45e6);
        fund.execute(id);

        assertTrue(fund.closed());
        assertEq(fund.totalPendingDollar(), 0);
        assertEq(fund.pendingDollar(members[0]), 0);
        assertEq(fund.pendingDollar(members[2]), 0);
        // Pending dollars come back first, whole; only the stray 10e6 is split by contributed.
        assertEq(dollar.balanceOf(members[0]), 20e6 + 10e6 * c0 / total);
        assertEq(dollar.balanceOf(members[1]), 10e6 * c1 / total);
        assertEq(dollar.balanceOf(members[2]), 15e6);
        assertEq(dollar.balanceOf(members[3]), 0);
        assertEq(dollar.balanceOf(members[4]), 0);
        // The currency goes pro rata by contributed, and nothing goes to a member who contributed none.
        assertEq(currency.balanceOf(members[0]), available * c0 / total);
        assertEq(currency.balanceOf(members[1]), available * c1 / total);
        assertEq(currency.balanceOf(members[2]), 0);
        // Only rounding dust stays.
        assertLt(dollar.balanceOf(address(fund)), 3);
    }

    function test_closeKeepsFeeOwedForPayFee() public {
        _contribute(members[0], 100_000e18);
        _contribute(members[1], 50_000e18);
        uint256 owed = fund.feeOwed();
        uint256 available = fund.availableCurrency();
        assertGt(owed, 0);

        _closeFund();

        assertEq(fund.feeOwed(), owed);
        uint256 toMembers;
        for (uint256 i; i < 5; ++i) {
            toMembers += currency.balanceOf(members[i]);
        }
        assertLe(toMembers, available, "members got no more than what was available");
        assertGe(currency.balanceOf(address(fund)), owed);
        assertLt(currency.balanceOf(address(fund)) - owed, 5, "only dust above the fee owed");

        vm.expectEmit(address(fund));
        emit FundV2.FeePaid(owed);
        fund.payFee();
        assertEq(currency.balanceOf(feeRecipient), owed);
        assertEq(fund.feeOwed(), 0);
        for (uint256 i; i < 5; ++i) {
            assertEq(currency.balanceOf(members[i]), available * fund.contributed(members[i]) / fund.totalContributed());
        }
    }

    function test_closeSplitsEquallyWhenNobodyContributed() public {
        currency.mint(address(fund), 5_000e18);
        _contributeDollar(members[0], 5e6);
        dollar.mint(address(fund), 10e6);
        assertEq(fund.totalContributed(), 0);

        _closeFund();

        for (uint256 i; i < 5; ++i) {
            assertEq(currency.balanceOf(members[i]), 1_000e18);
        }
        assertEq(dollar.balanceOf(members[0]), 5e6 + 2e6, "its pending dollars first, then an equal part of the stray");
        for (uint256 i = 1; i < 5; ++i) {
            assertEq(dollar.balanceOf(members[i]), 2e6);
        }
        assertEq(currency.balanceOf(address(fund)), 0);
        assertEq(dollar.balanceOf(address(fund)), 0);
    }

    function test_closeLeavesDivisionDustWhenNobodyContributed() public {
        currency.mint(address(fund), 5_000e18 + 3);
        dollar.mint(address(fund), 10e6 + 4);
        _closeFund();
        for (uint256 i; i < 5; ++i) {
            assertEq(currency.balanceOf(members[i]), 1_000e18);
            assertEq(dollar.balanceOf(members[i]), 2e6);
        }
        assertEq(currency.balanceOf(address(fund)), 3);
        assertEq(dollar.balanceOf(address(fund)), 4);
    }

    function test_closeWithoutDollar() public {
        fund = _create(_paramsNoDollar());
        _contribute(members[0], 100_000e18);
        _contribute(members[1], 50_000e18);
        dollar.mint(address(fund), 7e6); // a dollar sent straight to a fund that has none is ignored
        uint256 available = fund.availableCurrency();
        uint256 total = fund.totalContributed();
        uint256 c0 = fund.contributed(members[0]);

        uint256 id = _propose(members[0], FundV2.Action.Close, address(0), address(0), 0);
        _castVotes(id);
        vm.expectEmit(address(fund));
        emit FundV2.FundClosed(available, 0);
        fund.execute(id);

        assertTrue(fund.closed());
        assertEq(currency.balanceOf(members[0]), available * c0 / total);
        assertEq(dollar.balanceOf(address(fund)), 7e6);
        for (uint256 i; i < 5; ++i) {
            assertEq(dollar.balanceOf(members[i]), 0);
        }
    }

    // ---------------------------------------------------------------- After closing
    // What arrives after closing is split with the close's rule: the currency by what the fund can pay, and the dollar.
    function test_distributeRemainderSplitsLateArrivals() public {
        _contribute(members[0], 100_000e18); // credits 99_750e18
        _contribute(members[1], 50_000e18); // credits 49_875e18: exactly half of members[0]'s
        uint256 owed = fund.feeOwed();
        assertEq(owed, 375e18);
        _closeFund();
        assertEq(currency.balanceOf(members[0]), 99_750e18);
        assertEq(currency.balanceOf(members[1]), 49_875e18);
        assertEq(currency.balanceOf(address(fund)), owed, "no dust: the fee owed is all that stays");

        currency.mint(address(fund), 3_000e18);
        dollar.mint(address(fund), 9e6);
        vm.expectEmit(address(fund));
        emit FundV2.RemainderDistributed(3_000e18, 9e6);
        vm.prank(outsider);
        fund.distributeRemainder();

        assertEq(currency.balanceOf(members[0]), 99_750e18 + 2_000e18);
        assertEq(currency.balanceOf(members[1]), 49_875e18 + 1_000e18);
        assertEq(dollar.balanceOf(members[0]), 6e6);
        assertEq(dollar.balanceOf(members[1]), 3e6);
        assertEq(currency.balanceOf(members[2]), 0);
        assertEq(dollar.balanceOf(members[2]), 0);
        assertEq(currency.balanceOf(address(fund)), owed, "the fee owed never reaches a member");
        assertEq(dollar.balanceOf(address(fund)), 0);
        assertEq(fund.feeOwed(), owed);

        // With only the fee owed left there is nothing to split, and it stays there.
        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.distributeRemainder();
        assertEq(currency.balanceOf(address(fund)), owed);

        // The fee is still collected after the remainder was split.
        fund.payFee();
        assertEq(currency.balanceOf(feeRecipient), owed);
        assertEq(currency.balanceOf(address(fund)), 0);
    }

    function test_distributeRemainderRevertsBeforeClose() public {
        currency.mint(address(fund), 1_000e18);
        vm.expectRevert(FundV2.FundNotClosed.selector);
        fund.distributeRemainder();
    }

    function test_distributeRemainderRevertsWithNothingToSplit() public {
        _closeFund();
        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.distributeRemainder();
    }

    function test_distributeRemainderSplitsEquallyWhenNobodyContributed() public {
        _closeFund();
        currency.mint(address(fund), 5_000e18);
        vm.expectEmit(address(fund));
        emit FundV2.RemainderDistributed(5_000e18, 0);
        fund.distributeRemainder();
        for (uint256 i; i < 5; ++i) {
            assertEq(currency.balanceOf(members[i]), 1_000e18);
        }
    }

    function test_distributeRemainderWithoutDollar() public {
        fund = _create(_paramsNoDollar());
        _contribute(members[0], 100_000e18);
        _closeFund();
        currency.mint(address(fund), 4_000e18);
        dollar.mint(address(fund), 9e6); // ignored: the fund has no dollar
        vm.expectEmit(address(fund));
        emit FundV2.RemainderDistributed(4_000e18, 0);
        fund.distributeRemainder();
        assertEq(currency.balanceOf(members[0]), _net(100_000e18) + 4_000e18);
        assertEq(dollar.balanceOf(address(fund)), 9e6);
    }

    function test_nothingWorksAfterCloseButRemainderAndFee() public {
        _contribute(members[0], 1_000e18);
        _contributeDollar(members[1], 5e6);
        uint256 pending = _propose(members[0], FundV2.Action.Pay, members[1], address(0), 1);
        _closeFund();

        currency.mint(members[0], 1e18);
        dollar.mint(members[0], 1e6);
        vm.startPrank(members[0]);
        currency.approve(address(fund), 1e18);
        dollar.approve(address(fund), 1e6);
        vm.expectRevert(FundV2.FundIsClosed.selector);
        fund.contribute(1e18);
        vm.expectRevert(FundV2.FundIsClosed.selector);
        fund.contributeDollar(1e6);
        vm.expectRevert(FundV2.FundIsClosed.selector);
        fund.propose(FundV2.Action.Pay, members[1], address(0), 1, "x");
        vm.stopPrank();

        vm.prank(members[2]);
        vm.expectRevert(FundV2.FundIsClosed.selector);
        fund.vote(pending);
        vm.expectRevert(FundV2.FundIsClosed.selector);
        fund.execute(pending);

        address[] memory who = new address[](1);
        who[0] = members[1];
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.startPrank(agent);
        vm.expectRevert(FundV2.FundIsClosed.selector);
        fund.convert(who, amounts, 0);
        vm.expectRevert(FundV2.FundIsClosed.selector);
        fund.reimburseAgreedExpense(members[0], 1, bytes32(0));
        vm.stopPrank();

        // The fee is still collected, and a late arrival is still split.
        fund.payFee();
        currency.mint(address(fund), 1_000e18);
        fund.distributeRemainder();
    }

    // ---------------------------------------------------------------- Rounding and the fee owed (Review Focus 2)
    function testFuzz_closeNeverTouchesFeeOwed(
        uint96 a,
        uint96 b,
        uint96 c,
        uint64 pendingA,
        uint64 pendingB,
        uint64 strayD
    ) public {
        _contribute(members[0], bound(a, 1, 100_000e18));
        _contribute(members[1], bound(b, 1, 100_000e18));
        _contribute(members[2], bound(c, 1, 100_000e18));
        uint256 pA = bound(pendingA, 0, 30e6); // small enough to stay under the balance cap
        uint256 pB = bound(pendingB, 0, 30e6);
        uint256 stray = bound(strayD, 0, 30e6);
        if (pA > 0) _contributeDollar(members[0], pA);
        if (pB > 0) _contributeDollar(members[3], pB);
        dollar.mint(address(fund), stray);
        currency.mint(address(fund), bound(a, 0, 1_000e18)); // a direct transfer, credited to no one

        uint256 owed = fund.feeOwed();
        uint256 available = fund.availableCurrency();
        uint256 total = fund.totalContributed();
        uint256[3] memory contribs;
        for (uint256 i; i < 3; ++i) {
            contribs[i] = fund.contributed(members[i]);
        }

        _closeFund();

        assertEq(fund.feeOwed(), owed);
        assertEq(fund.totalPendingDollar(), 0);
        uint256 currencyPaid;
        for (uint256 i; i < 3; ++i) {
            uint256 expected = available * contribs[i] / total;
            assertEq(currency.balanceOf(members[i]), expected);
            currencyPaid += expected;
        }
        assertEq(currency.balanceOf(address(fund)), owed + available - currencyPaid, "the fee owed, and only dust more");
        assertLt(available - currencyPaid, 3);
        assertEq(dollar.balanceOf(members[0]), pA + stray * contribs[0] / total);
        assertEq(dollar.balanceOf(members[1]), stray * contribs[1] / total);
        assertEq(dollar.balanceOf(members[2]), stray * contribs[2] / total);
        assertEq(dollar.balanceOf(members[3]), pB);
        assertLt(dollar.balanceOf(address(fund)), 3);
    }
}
