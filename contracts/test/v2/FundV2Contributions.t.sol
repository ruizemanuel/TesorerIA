// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";

contract FundV2ContributionsTest is BaseFundV2Test {
    // ---------------------------------------------------------------- Contributing
    function test_contributeCreditsNetAndAccruesFee() public {
        _contribute(members[0], 10_025e18);
        assertEq(fund.contributed(members[0]), _net(10_025e18));
        assertEq(fund.totalContributed(), _net(10_025e18));
        assertEq(fund.feeOwed(), 10_025e18 * 25 / 10_000);
        assertEq(fund.availableCurrency(), _net(10_025e18));
        assertEq(fund.balanceInCurrency(), _net(10_025e18));
        assertEq(currency.balanceOf(address(fund)), 10_025e18);
    }

    function test_contributeEmitsNetCredited() public {
        currency.mint(members[0], 10_025e18);
        vm.startPrank(members[0]);
        currency.approve(address(fund), 10_025e18);
        vm.expectEmit(true, true, false, true, address(fund));
        emit FundV2.Contribution(members[0], address(currency), 10_025e18, _net(10_025e18));
        fund.contribute(10_025e18);
        vm.stopPrank();
    }

    function test_zeroFeeCreditsEverything() public {
        FundV2.Params memory p = _params();
        p.feeBps = 0;
        fund = _create(p);
        _contribute(members[0], 10_000e18);
        assertEq(fund.contributed(members[0]), 10_000e18);
        assertEq(fund.totalContributed(), 10_000e18);
        assertEq(fund.feeOwed(), 0);
        assertEq(fund.availableCurrency(), 10_000e18);
    }

    /// CIP-64 rule: the fund credits and takes the fee on what actually arrived, measured by balance difference,
    /// never on the amount sent.
    function test_contributeCreditsOnlyWhatArrivesWithATransferFee() public {
        currency.setFeeBps(100); // 1% never arrives
        currency.mint(members[0], 10_000e18);
        vm.startPrank(members[0]);
        currency.approve(address(fund), 10_000e18);
        uint256 fee = 9_900e18 * FEE_BPS / 10_000;
        vm.expectEmit(true, true, false, true, address(fund));
        emit FundV2.Contribution(members[0], address(currency), 9_900e18, 9_900e18 - fee);
        fund.contribute(10_000e18);
        vm.stopPrank();

        assertEq(currency.balanceOf(address(fund)), 9_900e18);
        assertEq(fund.feeOwed(), fee);
        assertEq(fund.contributed(members[0]), 9_900e18 - fee);
        assertEq(fund.totalContributed(), 9_900e18 - fee);
        assertEq(fund.availableCurrency(), 9_900e18 - fee);
    }

    function test_balanceCapCountsAvailableOnly() public {
        uint256 a = BALANCE_CAP * 10_000 / 9_975;
        _contribute(members[0], a);
        // The raw balance is above the cap; only what is available counts toward it.
        assertGt(currency.balanceOf(address(fund)), BALANCE_CAP);
        assertLe(fund.availableCurrency(), BALANCE_CAP);

        currency.mint(members[1], 1e18);
        vm.startPrank(members[1]);
        currency.approve(address(fund), 1e18);
        vm.expectRevert(FundV2.BalanceCapExceeded.selector);
        fund.contribute(1e18);
        vm.stopPrank();
    }

    function test_onlyMembersContribute() public {
        currency.mint(outsider, 100e18);
        vm.startPrank(outsider);
        currency.approve(address(fund), 100e18);
        vm.expectRevert(FundV2.NotMember.selector);
        fund.contribute(100e18);
        vm.stopPrank();
    }

    function test_zeroContributionReverts() public {
        vm.prank(members[0]);
        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.contribute(0);
    }

    // ---------------------------------------------------------------- Paying the fee
    function test_payFeeSendsOwedToRecipient() public {
        _contribute(members[0], 10_025e18);
        uint256 owed = fund.feeOwed();
        assertGt(owed, 0);
        uint256 availableBefore = fund.availableCurrency();

        vm.expectEmit(false, false, false, true, address(fund));
        emit FundV2.FeePaid(owed);
        vm.prank(outsider);
        fund.payFee();

        assertEq(currency.balanceOf(feeRecipient), owed);
        assertEq(fund.feeOwed(), 0);
        assertEq(fund.availableCurrency(), availableBefore);
    }

    function test_payFeeWithNothingOwedReverts() public {
        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.payFee();
    }
}
