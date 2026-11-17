// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {Attacker, MockPoolHostile} from "../mocks/MockPoolHostile.sol";

contract FundV2ConversionTest is BaseFundV2Test {
    /// The fund of every test: m0 has 60 pending dollars and m1 has 40. It has room under its cap for the fuzz test's
    /// thousands of dollars (the default cap is only ~ 280 dollars at this pool's price).
    function setUp() public override {
        super.setUp();
        fund = _create(_roomyParams());
        _contributeDollar(members[0], 60e6);
        _contributeDollar(members[1], 40e6);
    }

    function _roomyParams() internal view returns (FundV2.Params memory p) {
        p = _params();
        p.balanceCap = 100_000_000e18;
    }

    function _list(address a) internal pure returns (address[] memory l) {
        l = new address[](1);
        l[0] = a;
    }

    function _list(address a, address b) internal pure returns (address[] memory l) {
        l = new address[](2);
        l[0] = a;
        l[1] = b;
    }

    function _list(address a, address b, address c) internal pure returns (address[] memory l) {
        l = new address[](3);
        l[0] = a;
        l[1] = b;
        l[2] = c;
    }

    function _amounts(uint256 a) internal pure returns (uint256[] memory l) {
        l = new uint256[](1);
        l[0] = a;
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory l) {
        l = new uint256[](2);
        l[0] = a;
        l[1] = b;
    }

    function _amounts(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory l) {
        l = new uint256[](3);
        l[0] = a;
        l[1] = b;
        l[2] = c;
    }

    /// What the (mock) pool delivers for `dollarAmount`: exactly the TWAP quote.
    function _out(uint256 dollarAmount) internal view returns (uint256) {
        return fund.quoteDollar(dollarAmount);
    }

    function _fee(uint256 share) internal pure returns (uint256) {
        return share * FEE_BPS / 10_000;
    }

    // ---------------------------------------------------------------- Crediting
    function test_convertCreditsEachMemberTheirShareNetOfFee() public {
        uint256 out = _out(100e6);
        uint256 s0 = out * 60 / 100;
        uint256 s1 = out * 40 / 100;
        uint256 net0 = s0 - _fee(s0);
        uint256 net1 = s1 - _fee(s1);

        vm.expectEmit(true, false, false, true, address(fund));
        emit FundV2.Conversion(members[0], 60e6, s0, net0);
        vm.expectEmit(true, false, false, true, address(fund));
        emit FundV2.Conversion(members[1], 40e6, s1, net1);
        vm.prank(agent);
        uint256 received = fund.convert(_list(members[0], members[1]), _amounts(60e6, 40e6), out * 99 / 100);

        assertEq(received, out);
        assertEq(fund.contributed(members[0]), net0);
        assertEq(fund.contributed(members[1]), net1);
        assertEq(fund.totalContributed(), net0 + net1);
        assertEq(fund.pendingDollar(members[0]), 0);
        assertEq(fund.pendingDollar(members[1]), 0);
        assertEq(fund.totalPendingDollar(), 0);
        assertEq(fund.feeOwed(), _fee(s0) + _fee(s1));
        assertEq(dollar.balanceOf(address(fund)), 0);
        assertEq(currency.balanceOf(address(fund)), out);
        assertEq(fund.availableCurrency(), out - fund.feeOwed());
    }

    function test_convertPartOfPending() public {
        uint256 out = _out(30e6);
        vm.prank(agent);
        uint256 received = fund.convert(_list(members[0]), _amounts(30e6), out * 99 / 100);

        assertEq(received, out);
        assertEq(fund.pendingDollar(members[0]), 30e6);
        assertEq(fund.pendingDollar(members[1]), 40e6);
        assertEq(fund.totalPendingDollar(), 70e6);
        assertEq(dollar.balanceOf(address(fund)), 70e6);
        // The only member converting is the whole of the conversion's total, so they get all of it, net of the fee.
        assertEq(fund.contributed(members[0]), out - _fee(out));
        assertEq(fund.contributed(members[1]), 0);
        assertEq(fund.feeOwed(), _fee(out));
    }

    /// What the split can't divide evenly belongs to no one: it stays in the fund, in what it can pay or split.
    function test_convertLeavesRoundingDustUnassigned() public {
        _contributeDollar(members[2], 7);
        uint256 a0 = 33_333_333;
        uint256 a1 = 33_333_331;
        uint256 a2 = 7;
        uint256 total = a0 + a1 + a2;
        uint256 out = _out(total);
        uint256 s0 = out * a0 / total;
        uint256 s1 = out * a1 / total;
        uint256 s2 = out * a2 / total;
        uint256 dust = out - (s0 + s1 + s2);
        assertGt(dust, 0); // the amounts do leave a remainder

        uint256 availableBefore = fund.availableCurrency();
        vm.prank(agent);
        address[] memory who = _list(members[0], members[1], members[2]);
        uint256 received = fund.convert(who, _amounts(a0, a1, a2), out * 99 / 100);

        assertEq(received, out);
        uint256 credited = fund.contributed(members[0]) + fund.contributed(members[1]) + fund.contributed(members[2]);
        assertEq(credited, (s0 - _fee(s0)) + (s1 - _fee(s1)) + (s2 - _fee(s2)));
        assertEq(fund.feeOwed(), _fee(s0) + _fee(s1) + _fee(s2));
        assertLe(s0 + s1 + s2, out);
        // Everything that arrived is credited, set aside as the fee, or the unassigned remainder.
        assertEq(fund.availableCurrency() - availableBefore, credited + dust);
        assertEq(currency.balanceOf(address(fund)), credited + fund.feeOwed() + dust);
    }

    /// Review focus: what is credited plus what is set aside as the fee never exceeds what the swap delivered.
    function testFuzz_convertSplitNeverExceedsOut(uint256 a0, uint256 a1, uint256 a2) public {
        a0 = bound(a0, 1, 1_000e6);
        a1 = bound(a1, 1, 1_000e6);
        a2 = bound(a2, 1, 1_000e6);
        _contributeDollar(members[2], a0);
        _contributeDollar(members[3], a1);
        _contributeDollar(members[4], a2);

        uint256 minOut = _out(a0 + a1 + a2) * 9_800 / 10_000;
        vm.prank(agent);
        uint256 received = fund.convert(_list(members[2], members[3], members[4]), _amounts(a0, a1, a2), minOut);

        uint256 credited = fund.contributed(members[2]) + fund.contributed(members[3]) + fund.contributed(members[4]);
        assertEq(fund.totalContributed(), credited);
        assertLe(credited + fund.feeOwed(), received);
        // What is credited plus the fee is the sum of the shares, each rounded down by less than one unit.
        assertLt(received - (credited + fund.feeOwed()), 3);
        assertEq(fund.totalPendingDollar(), 100e6); // m0's and m1's dollars, untouched
    }

    // ---------------------------------------------------------------- Who and with what
    function test_onlyAgentConverts() public {
        vm.prank(members[0]);
        vm.expectRevert(FundV2.OnlyAgent.selector);
        fund.convert(_list(members[0]), _amounts(1e6), 0);

        vm.prank(outsider);
        vm.expectRevert(FundV2.OnlyAgent.selector);
        fund.convert(_list(members[0]), _amounts(1e6), 0);
    }

    function test_convertRejectsBadLists() public {
        vm.startPrank(agent);

        vm.expectRevert(FundV2.InvalidParams.selector);
        fund.convert(new address[](0), new uint256[](0), 0);

        vm.expectRevert(FundV2.InvalidParams.selector);
        fund.convert(_list(members[0], members[1]), _amounts(1e6), 0);

        vm.expectRevert(FundV2.InvalidParams.selector);
        fund.convert(_list(members[0]), _amounts(1e6, 1e6), 0);

        // The same member twice, even when each of the two would fit within what they have pending.
        vm.expectRevert(FundV2.InvalidParams.selector);
        fund.convert(_list(members[0], members[0]), _amounts(10e6, 10e6), 0);

        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.convert(_list(members[0]), _amounts(0), 0);

        vm.expectRevert(FundV2.ZeroAmount.selector);
        fund.convert(_list(members[0], members[1]), _amounts(1e6, 0), 0);

        vm.stopPrank();
    }

    function test_convertRejectsMoreThanPending() public {
        vm.startPrank(agent);

        vm.expectRevert(FundV2.InsufficientPending.selector);
        fund.convert(_list(members[0]), _amounts(60e6 + 1), 0);

        // The total fits within all the pending dollars, but one member is asked for more than they have.
        vm.expectRevert(FundV2.InsufficientPending.selector);
        fund.convert(_list(members[0], members[1]), _amounts(70e6, 30e6), 0);

        // A member with nothing pending, and someone who isn't a member at all.
        vm.expectRevert(FundV2.InsufficientPending.selector);
        fund.convert(_list(members[2]), _amounts(1), 0);
        vm.expectRevert(FundV2.InsufficientPending.selector);
        fund.convert(_list(outsider), _amounts(1), 0);

        vm.stopPrank();
    }

    // ---------------------------------------------------------------- The price
    /// The minimum can't be more than 2% below the TWAP quote of the whole conversion, and exactly 2% is allowed.
    function test_minOutFloorIsTwapLessTwoPercent() public {
        uint256 floor = _out(100e6) * 9_800 / 10_000;
        vm.startPrank(agent);

        vm.expectRevert(FundV2.MinOutTooLow.selector);
        fund.convert(_list(members[0], members[1]), _amounts(60e6, 40e6), floor - 1);

        pool.setQuality(9_800); // delivers 2% less: exactly the floor
        uint256 received = fund.convert(_list(members[0], members[1]), _amounts(60e6, 40e6), floor);
        vm.stopPrank();
        assertEq(received, floor);
        assertEq(fund.totalPendingDollar(), 0);
    }

    function test_poorSwapReverts() public {
        uint256 floor = _out(100e6) * 9_800 / 10_000;
        pool.setQuality(9_700); // delivers 3% less
        vm.prank(agent);
        vm.expectRevert(FundV2.InsufficientOutput.selector);
        fund.convert(_list(members[0], members[1]), _amounts(60e6, 40e6), floor);
        // The whole conversion reverted: nothing was taken from anyone.
        assertEq(fund.pendingDollar(members[0]), 60e6);
        assertEq(fund.pendingDollar(members[1]), 40e6);
        assertEq(dollar.balanceOf(address(fund)), 100e6);
    }

    // ---------------------------------------------------------------- The swap's callback
    function test_hostilePoolCannotOvercharge() public {
        uint256 floor = _out(100e6) * 9_800 / 10_000;
        pool.setOvercharge(1);
        vm.prank(agent);
        vm.expectRevert(FundV2.SwapOverpayment.selector);
        fund.convert(_list(members[0], members[1]), _amounts(60e6, 40e6), floor);
    }

    function test_poolCannotCollectTwice() public {
        uint256 floor = _out(100e6) * 9_800 / 10_000;
        pool.setCollectTwice(true);
        vm.prank(agent);
        vm.expectRevert(FundV2.OnlyPool.selector);
        fund.convert(_list(members[0], members[1]), _amounts(60e6, 40e6), floor);
    }

    function test_callbackOnlyFromPoolDuringConvert() public {
        // From the pool, but outside a conversion.
        vm.prank(address(pool));
        vm.expectRevert(FundV2.OnlyPool.selector);
        fund.uniswapV3SwapCallback(0, 1e6, "");
        // From someone else.
        vm.prank(outsider);
        vm.expectRevert(FundV2.OnlyPool.selector);
        fund.uniswapV3SwapCallback(0, 1e6, "");
        vm.prank(agent);
        vm.expectRevert(FundV2.OnlyPool.selector);
        fund.uniswapV3SwapCallback(0, 1e6, "");
    }

    /// New fund on a pool that, in the middle of the swap, lets a third party call the fund's callback.
    function _fundWithHostilePool() internal returns (Attacker attacker) {
        MockPoolHostile hostile = new MockPoolHostile(address(currency), address(dollar), -350142);
        currency.mint(address(hostile), 1_000_000_000e18);
        uniFactory.setPool(address(currency), address(dollar), hostile.fee(), address(hostile));
        pool = MockPool(address(hostile));
        fund = _create(_roomyParams());
        _contributeDollar(members[0], 50e6);
        attacker = hostile.attacker();
    }

    function test_nonPoolCannotCollectDuringTheConversion() public {
        _fundWithHostilePool();
        uint256 floor = _out(10e6) * 9_800 / 10_000;
        vm.prank(agent);
        vm.expectRevert(FundV2.OnlyPool.selector);
        fund.convert(_list(members[0]), _amounts(10e6), floor);
    }

    function test_thirdPartyDuringTheConversionCannotTakeTheFundDollars() public {
        Attacker attacker = _fundWithHostilePool();
        attacker.setSwallowError(true);
        uint256 floor = _out(10e6) * 9_800 / 10_000;
        vm.prank(agent);
        fund.convert(_list(members[0]), _amounts(10e6), floor);
        assertEq(attacker.lastError(), abi.encodeWithSelector(FundV2.OnlyPool.selector));
        assertEq(dollar.balanceOf(address(fund)), 40e6); // it only paid the swap's 10 dollars
        assertEq(dollar.balanceOf(address(pool)), 10e6);
        assertEq(fund.pendingDollar(members[0]), 40e6);
    }

    // ---------------------------------------------------------------- The pool's orientation
    /// With the dollar as the pool's token0 the fund sells token0 for token1 (zeroForOne), and the callback pays the
    /// dollar's delta, which is the pool's amount0.
    function test_convertWhenTheDollarIsToken0() public {
        MockERC20 d = new MockERC20("USDT", "USDT", 6);
        MockERC20 c = new MockERC20("wARS", "wARS", 18);
        // Token addresses depend on deployment order; redeploy the currency until the dollar sorts first.
        while (address(c) < address(d)) c = new MockERC20("wARS", "wARS", 18);
        int24 tick = 350142; // with the dollar as token0, the price is the currency per dollar
        MockPool reversed = new MockPool(address(c), address(d), tick);
        assertEq(reversed.token0(), address(d));
        c.mint(address(reversed), 1_000_000_000e18);
        d.mint(address(reversed), 1_000_000e6);
        uniFactory.setPool(address(c), address(d), reversed.fee(), address(reversed));

        FundV2.Params memory p = _roomyParams();
        p.currency = IERC20(address(c));
        p.dollar = IERC20(address(d));
        p.pool = IUniswapV3Pool(address(reversed));
        currency = c;
        dollar = d;
        pool = reversed;
        fund = _create(p);
        _contributeDollar(members[0], 60e6);
        _contributeDollar(members[1], 40e6);

        uint256 out = OracleLibrary.getQuoteAtTick(tick, 100e6, address(d), address(c));
        assertEq(fund.quoteDollar(100e6), out);
        uint256 s0 = out * 60 / 100;
        uint256 s1 = out * 40 / 100;

        vm.prank(agent);
        uint256 received = fund.convert(_list(members[0], members[1]), _amounts(60e6, 40e6), out * 99 / 100);

        assertEq(received, out);
        assertApproxEqRel(received, 160_588e18, 0.001e18); // the same price as the wARS/USDT pool, 1,605.88 per dollar
        assertEq(d.balanceOf(address(fund)), 0);
        assertEq(d.balanceOf(address(reversed)), 1_000_000e6 + 100e6); // the pool got the dollars
        assertEq(c.balanceOf(address(fund)), out); // and the fund got the currency
        assertEq(fund.contributed(members[0]), s0 - _fee(s0));
        assertEq(fund.contributed(members[1]), s1 - _fee(s1));
        assertEq(fund.pendingDollar(members[0]), 0);
        assertEq(fund.pendingDollar(members[1]), 0);
    }
}
