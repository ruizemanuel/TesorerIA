// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";

contract FundCloseTest is BaseFundTest {
    function _close() internal {
        uint256 id = _propose(members[0], Fund.Action.Close, address(0), address(0), 0);
        _castVotes(id, 1, 3);
        fund.execute(id);
    }

    function test_closeSplitsByContribution() public {
        _contributeWars(members[0], 30_000e18);
        _contributeWars(members[1], 10_000e18);
        _close();
        assertTrue(fund.closed());
        assertEq(wars.balanceOf(members[0]), 30_000e18);
        assertEq(wars.balanceOf(members[1]), 10_000e18);
        assertEq(wars.balanceOf(members[2]), 0);
    }

    function test_closeWithUnconvertedUsdt() public {
        _contributeWars(members[0], 16_058.8e18);
        _contributeUsdt(members[1], 10e6);
        _close();
        assertApproxEqAbs(usdt.balanceOf(members[1]), 5e6, 0.02e6);
        assertApproxEqAbs(usdt.balanceOf(members[0]), 5e6, 0.02e6);
    }

    function test_withoutContributionsSplitsEqually() public {
        wars.mint(address(fund), 5_000e18);
        _close();
        for (uint256 i; i < 5; ++i) assertEq(wars.balanceOf(members[i]), 1_000e18);
    }

    // Review Focus 1: what reaches the contract directly is credited to no one and is split by contribution.
    function test_directTransferIsSplitByContribution() public {
        _contributeWars(members[0], 30_000e18);
        _contributeWars(members[1], 10_000e18);
        wars.mint(address(fund), 4_000e18); // for example, a withdrawal sent to the contract by mistake
        assertEq(fund.totalContributed(), 40_000e18);
        _close();
        assertEq(wars.balanceOf(members[0]), 33_000e18);
        assertEq(wars.balanceOf(members[1]), 11_000e18);
    }

    function test_everythingRevertsAfterClosing() public {
        _contributeWars(members[0], 1_000e18);
        _close();
        vm.prank(members[0]);
        vm.expectRevert(Fund.FundIsClosed.selector);
        fund.contributeWars(1);
        vm.prank(agent);
        vm.expectRevert(Fund.FundIsClosed.selector);
        fund.reimburseAgreedExpense(members[0], 1, bytes32(0));
        vm.prank(members[0]);
        vm.expectRevert(Fund.FundIsClosed.selector);
        fund.propose(Fund.Action.Pay, members[1], address(0), 1, "x");
    }

    function testFuzz_closeConservesTheBalance(uint96 a, uint96 b, uint96 c) public {
        uint256 x = bound(a, 1, 100_000e18);
        uint256 y = bound(b, 1, 100_000e18);
        uint256 z = bound(c, 1, 100_000e18);
        _contributeWars(members[0], x);
        _contributeWars(members[1], y);
        _contributeWars(members[2], z);
        _close();
        uint256 paidOut = wars.balanceOf(members[0]) + wars.balanceOf(members[1]) + wars.balanceOf(members[2]);
        assertLe(paidOut, x + y + z);
        assertLe(wars.balanceOf(address(fund)), 5); // rounding dust: under 1 wei per member
    }

    // Review fix: part of the balance also arrives by direct transfer, so the split really rounds.
    function testFuzz_closeSplitsByContributionWithRounding(uint96 a, uint96 b, uint96 c, uint96 extraW, uint64 extraU)
        public
    {
        uint256[3] memory contribs;
        contribs[0] = bound(a, 1, 100_000e18);
        contribs[1] = bound(b, 1, 100_000e18);
        contribs[2] = bound(c, 1, 100_000e18);
        for (uint256 i; i < 3; ++i) _contributeWars(members[i], contribs[i]);
        wars.mint(address(fund), bound(extraW, 0, 100_000e18));
        usdt.mint(address(fund), bound(extraU, 0, 1_000e6));

        uint256 bw = wars.balanceOf(address(fund));
        uint256 bu = usdt.balanceOf(address(fund));
        uint256 t = fund.totalContributed();
        for (uint256 i; i < 3; ++i) contribs[i] = fund.contributed(members[i]);

        _close();

        uint256 sw;
        uint256 su;
        for (uint256 i; i < 3; ++i) {
            assertEq(wars.balanceOf(members[i]), bw * contribs[i] / t);
            assertEq(usdt.balanceOf(members[i]), bu * contribs[i] / t);
            sw += wars.balanceOf(members[i]);
            su += usdt.balanceOf(members[i]);
        }
        for (uint256 i = 3; i < 5; ++i) {
            assertEq(wars.balanceOf(members[i]), 0);
            assertEq(usdt.balanceOf(members[i]), 0);
        }
        assertEq(sw + wars.balanceOf(address(fund)), bw);
        assertEq(su + usdt.balanceOf(address(fund)), bu);
        assertLt(wars.balanceOf(address(fund)), 3);
        assertLt(usdt.balanceOf(address(fund)), 3);
    }

    // Review fix: with no contributions, the balance is split equally and the division remainder stays in the contract.
    function testFuzz_closeWithoutContributionsSplitsEqually(uint96 w, uint64 u) public {
        uint256 bw = bound(w, 1, 1_000_000e18);
        uint256 bu = bound(u, 1, 1_000_000e6);
        wars.mint(address(fund), bw);
        usdt.mint(address(fund), bu);

        _close();

        for (uint256 i; i < 5; ++i) {
            assertEq(wars.balanceOf(members[i]), bw / 5);
            assertEq(usdt.balanceOf(members[i]), bu / 5);
        }
        assertEq(wars.balanceOf(address(fund)), bw % 5);
        assertEq(usdt.balanceOf(address(fund)), bu % 5);
    }
}
