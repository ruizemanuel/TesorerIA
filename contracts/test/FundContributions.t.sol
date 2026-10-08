// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";

contract FundContributionsTest is BaseFundTest {
    function test_contributeWarsCreditsWhatArrived() public {
        wars.mint(members[0], 10_000e18);
        vm.startPrank(members[0]);
        wars.approve(address(fund), 10_000e18);
        vm.expectEmit(true, true, false, true, address(fund));
        emit Fund.Contribution(members[0], address(wars), 10_000e18, 10_000e18);
        fund.contributeWars(10_000e18);
        vm.stopPrank();
        assertEq(fund.contributed(members[0]), 10_000e18);
        assertEq(fund.totalContributed(), 10_000e18);
        assertEq(wars.balanceOf(address(fund)), 10_000e18);
    }

    function test_contributeUsdtCreditsAtTheTwap() public {
        _contributeUsdt(members[1], 10e6);
        assertApproxEqRel(fund.contributed(members[1]), 16_058.8e18, 0.001e18);
        assertEq(usdt.balanceOf(address(fund)), 10e6);
        assertApproxEqRel(fund.balanceInWars(), 16_058.8e18, 0.001e18);
    }

    function test_nonMemberCannotContribute() public {
        wars.mint(outsider, 1e18);
        vm.startPrank(outsider);
        wars.approve(address(fund), 1e18);
        vm.expectRevert(Fund.NotMember.selector);
        fund.contributeWars(1e18);
        vm.stopPrank();
    }

    function test_zeroContributionReverts() public {
        vm.prank(members[0]);
        vm.expectRevert(Fund.ZeroAmount.selector);
        fund.contributeWars(0);
    }

    function test_contributionOverTheBalanceCapReverts() public {
        _contributeWars(members[0], 440_000e18);
        wars.mint(members[1], 20_000e18);
        vm.startPrank(members[1]);
        wars.approve(address(fund), 20_000e18);
        vm.expectRevert(Fund.BalanceCapExceeded.selector);
        fund.contributeWars(20_000e18);
        vm.stopPrank();
    }

    function test_usdtCountsTowardTheBalanceCap() public {
        _contributeUsdt(members[0], 270e6); // ≈ 433,588 wARS
        usdt.mint(members[1], 20e6); // ≈ 32,118 wARS more: goes over 450,000
        vm.startPrank(members[1]);
        usdt.approve(address(fund), 20e6);
        vm.expectRevert(Fund.BalanceCapExceeded.selector);
        fund.contributeUsdt(20e6);
        vm.stopPrank();
    }

    function testFuzz_balanceCapIsNeverExceeded(uint256 a, uint256 b) public {
        a = bound(a, 1, 500_000e18);
        b = bound(b, 1, 500_000e18);
        wars.mint(members[0], a);
        vm.startPrank(members[0]);
        wars.approve(address(fund), a);
        if (a > BALANCE_CAP) vm.expectRevert(Fund.BalanceCapExceeded.selector);
        fund.contributeWars(a);
        vm.stopPrank();
        uint256 alreadyIn = wars.balanceOf(address(fund));
        wars.mint(members[1], b);
        vm.startPrank(members[1]);
        wars.approve(address(fund), b);
        if (alreadyIn + b > BALANCE_CAP) vm.expectRevert(Fund.BalanceCapExceeded.selector);
        fund.contributeWars(b);
        vm.stopPrank();
        assertLe(fund.balanceInWars(), BALANCE_CAP);
    }
}
