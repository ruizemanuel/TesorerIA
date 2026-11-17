// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPool} from "../mocks/MockPool.sol";

contract FundV2DollarTest is BaseFundV2Test {
    // ---------------------------------------------------------------- Contributing dollars
    function test_contributeDollarIsPendingNotCredited() public {
        dollar.mint(members[0], 100e6);
        vm.startPrank(members[0]);
        dollar.approve(address(fund), 100e6);
        vm.expectEmit(true, true, false, true, address(fund));
        emit FundV2.Contribution(members[0], address(dollar), 100e6, 0);
        fund.contributeDollar(100e6);
        vm.stopPrank();

        assertEq(fund.pendingDollar(members[0]), 100e6);
        assertEq(fund.totalPendingDollar(), 100e6);
        assertEq(fund.contributed(members[0]), 0);
        assertEq(fund.totalContributed(), 0);
        assertEq(fund.feeOwed(), 0);
        assertEq(dollar.balanceOf(address(fund)), 100e6);
    }

    function test_pendingDollarAddsUpPerMember() public {
        _contributeDollar(members[0], 100e6);
        _contributeDollar(members[1], 40e6);
        _contributeDollar(members[0], 5e6);
        assertEq(fund.pendingDollar(members[0]), 105e6);
        assertEq(fund.pendingDollar(members[1]), 40e6);
        assertEq(fund.pendingDollar(members[2]), 0);
        assertEq(fund.totalPendingDollar(), 145e6);
    }

    /// CIP-64 rule: the fund records what actually arrived, measured by balance difference, never the amount sent.
    function test_contributeDollarKeepsOnlyWhatArrivesWithATransferFee() public {
        dollar.setFeeBps(100); // 1% never arrives
        dollar.mint(members[0], 10e6);
        vm.startPrank(members[0]);
        dollar.approve(address(fund), 10e6);
        vm.expectEmit(true, true, false, true, address(fund));
        emit FundV2.Contribution(members[0], address(dollar), 9.9e6, 0);
        fund.contributeDollar(10e6);
        vm.stopPrank();

        assertEq(dollar.balanceOf(address(fund)), 9.9e6);
        assertEq(fund.pendingDollar(members[0]), 9.9e6);
        assertEq(fund.totalPendingDollar(), 9.9e6);
    }

    function test_onlyMembersContributeDollar() public {
        dollar.mint(outsider, 10e6);
        vm.startPrank(outsider);
        dollar.approve(address(fund), 10e6);
        vm.expectRevert(FundV2.NotMember.selector);
        fund.contributeDollar(10e6);
        vm.stopPrank();
    }

    function test_zeroDollarContributionReverts() public {
        vm.prank(members[0]);
        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.contributeDollar(0);
    }

    function test_dollarContributionRespectsBalanceCap() public {
        _contribute(members[0], 200_000e18); // 199,500 available
        _contributeDollar(members[1], 150e6); // ~ 240,882 more: ~ 440,382, under the 450,000 cap
        assertLe(fund.balanceInCurrency(), BALANCE_CAP);

        // Another 10 USDT (~ 16,058) takes the available currency plus every pending dollar over the cap.
        dollar.mint(members[2], 10e6);
        vm.startPrank(members[2]);
        dollar.approve(address(fund), 10e6);
        assertGt(fund.availableCurrency() + fund.quoteDollar(160e6), BALANCE_CAP);
        vm.expectRevert(FundV2.BalanceCapExceeded.selector);
        fund.contributeDollar(10e6);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- Quoting
    function test_quoteDollarUsesTwap() public view {
        uint256 quote = fund.quoteDollar(1e6);
        assertEq(quote, OracleLibrary.getQuoteAtTick(-350142, 1e6, address(dollar), address(currency)));
        assertApproxEqRel(quote, 1_605.88e18, 0.001e18);
    }

    function test_quoteDollarZeroDoesNotReadPool() public {
        pool.setObserveReverts(true);
        assertEq(fund.quoteDollar(0), 0);
        vm.expectRevert(bytes("OLD"));
        fund.quoteDollar(1e6);
    }

    function test_quoteDollarAboveUint128Reverts() public {
        vm.expectRevert(FundV2.InvalidParams.selector);
        fund.quoteDollar(uint256(type(uint128).max) + 1);
    }

    /// The quote doesn't depend on which token the pool lists first: `OracleLibrary` orders the two by address, so the
    /// quote is the dollar's worth in the currency at that pool's tick whichever way round the pool is.
    function test_quoteDollarWhenTheDollarIsToken0() public {
        MockERC20 d = new MockERC20("USDT", "USDT", 6);
        MockERC20 c = new MockERC20("wARS", "wARS", 18);
        // Token addresses depend on deployment order; redeploy the currency until the dollar sorts first.
        while (address(c) < address(d)) c = new MockERC20("wARS", "wARS", 18);
        // With the dollar as token0, the pool's price is the currency per dollar: tick +350142.
        int24 tick = 350142;
        MockPool reversed = new MockPool(address(c), address(d), tick);
        assertEq(reversed.token0(), address(d));
        uniFactory.setPool(address(c), address(d), reversed.fee(), address(reversed));

        FundV2.Params memory p = _params();
        p.currency = IERC20(address(c));
        p.dollar = IERC20(address(d));
        p.pool = IUniswapV3Pool(address(reversed));
        FundV2 f = _create(p);

        uint256 quote = f.quoteDollar(1e6);
        assertEq(quote, OracleLibrary.getQuoteAtTick(tick, 1e6, address(d), address(c)));
        // It is the same price as the wARS/USDT pool, where the dollar is token1.
        assertApproxEqRel(quote, 1_605.88e18, 0.001e18);
        assertApproxEqRel(quote, fund.quoteDollar(1e6), 0.001e18);
    }

    function test_balanceInCurrencyCountsAllDollars() public {
        _contribute(members[0], 10_000e18);
        _contributeDollar(members[1], 100e6);
        dollar.mint(address(fund), 50e6); // sent straight to the fund, not as a contribution
        assertEq(fund.totalPendingDollar(), 100e6);
        assertEq(dollar.balanceOf(address(fund)), 150e6);

        uint256 expected = fund.availableCurrency() + fund.quoteDollar(150e6);
        assertGt(fund.quoteDollar(150e6), 0);
        assertEq(fund.balanceInCurrency(), expected);
    }

    // ---------------------------------------------------------------- A fund without a dollar
    function test_noDollarFundRejectsDollarCalls() public {
        fund = _create(_paramsNoDollar());
        vm.prank(members[0]);
        vm.expectRevert(FundV2.NoDollar.selector);
        fund.contributeDollar(1e6);
        vm.expectRevert(FundV2.NoDollar.selector);
        fund.quoteDollar(1e6);
        vm.expectRevert(FundV2.NoDollar.selector);
        fund.quoteDollar(0);
        // Before the lists are even looked at, so empty ones don't turn it into InvalidParams.
        vm.prank(agent);
        vm.expectRevert(FundV2.NoDollar.selector);
        fund.convert(new address[](0), new uint256[](0), 0);
    }

    /// A fund with no dollar never reads a pool, so dollars someone sends it can't keep it from taking contributions.
    function test_noDollarFundIgnoresDollarSentDirectly() public {
        fund = _create(_paramsNoDollar());
        dollar.mint(address(fund), 1_000e6);
        _contribute(members[0], 1_000e18);
        assertEq(fund.contributed(members[0]), _net(1_000e18));
        assertEq(fund.balanceInCurrency(), fund.availableCurrency());
        assertEq(fund.balanceInCurrency(), _net(1_000e18));
    }
}
