// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {Attacker, MockPoolHostile} from "./mocks/MockPoolHostile.sol";

contract FundConversionTest is BaseFundTest {
    function setUp() public override {
        super.setUp();
        _contributeUsdt(members[0], 50e6);
    }

    function test_agentConvertsAtThePoolPrice() public {
        uint256 expected = fund.quoteUsdtInWars(30e6);
        vm.prank(agent);
        uint256 received = fund.convert(30e6, expected * 99 / 100);
        assertApproxEqRel(received, expected, 0.0001e18);
        assertEq(usdt.balanceOf(address(fund)), 20e6);
        assertEq(wars.balanceOf(address(fund)), received);
    }

    function test_emitsConversion() public {
        uint256 expected = fund.quoteUsdtInWars(10e6); // the mock pool delivers exactly the TWAP quote
        vm.expectEmit(address(fund));
        emit Fund.Conversion(10e6, expected);
        vm.prank(agent);
        fund.convert(10e6, expected * 99 / 100);
    }

    function test_onlyTheAgentCanConvert() public {
        vm.prank(members[0]);
        vm.expectRevert(Fund.OnlyAgent.selector);
        fund.convert(10e6, 1);
    }

    function test_minOutBelowTheMarginReverts() public {
        uint256 expected = fund.quoteUsdtInWars(10e6);
        vm.prank(agent);
        vm.expectRevert(Fund.MinOutTooLow.selector);
        fund.convert(10e6, expected * 97 / 100);
    }

    // Final review: the margin is exactly 2%. A minimum right at 98% of the quote passes (and so does a pool
    // that delivers exactly that); one wei less doesn't.
    function test_minOutExactlyAt98PercentIsAccepted() public {
        uint256 floor = fund.quoteUsdtInWars(10e6) * 9_800 / 10_000;
        pool.setQuality(9_800); // delivers 2% less: exactly the floor
        vm.prank(agent);
        uint256 received = fund.convert(10e6, floor);
        assertEq(received, floor);
        assertEq(usdt.balanceOf(address(fund)), 40e6);
    }

    function test_minOutOneWeiBelow98PercentReverts() public {
        uint256 floor = fund.quoteUsdtInWars(10e6) * 9_800 / 10_000;
        vm.prank(agent);
        vm.expectRevert(Fund.MinOutTooLow.selector);
        fund.convert(10e6, floor - 1);
    }

    function testFuzz_theMarginIsExactly2Percent(uint256 amount) public {
        amount = bound(amount, 1, 50e6);
        uint256 floor = fund.quoteUsdtInWars(amount) * 9_800 / 10_000;
        pool.setQuality(9_800);
        vm.startPrank(agent);
        vm.expectRevert(Fund.MinOutTooLow.selector);
        fund.convert(amount, floor - 1);
        assertEq(fund.convert(amount, floor), floor);
        vm.stopPrank();
    }

    function test_ifThePoolDeliversLessThanMinOutItReverts() public {
        uint256 expected = fund.quoteUsdtInWars(10e6);
        pool.setQuality(9_850); // delivers 1.5% less
        vm.prank(agent);
        vm.expectRevert(Fund.InsufficientOutput.selector);
        fund.convert(10e6, expected * 99 / 100);
    }

    function test_cannotConvertMoreUsdtThanTheFundHolds() public {
        vm.prank(agent);
        vm.expectRevert(Fund.InsufficientBalance.selector);
        fund.convert(51e6, 1);
    }

    function test_callbackOutsideAConversionReverts() public {
        vm.prank(address(pool));
        vm.expectRevert(Fund.OnlyPool.selector);
        fund.uniswapV3SwapCallback(0, 1e6, "");
    }

    function test_callbackFromSomeoneOtherThanThePoolReverts() public {
        vm.prank(outsider);
        vm.expectRevert(Fund.OnlyPool.selector);
        fund.uniswapV3SwapCallback(0, 1e6, "");
    }

    // The pool itself can't collect more than the USDT being converted...
    function test_poolCannotCollectMoreThanTheAmountConverted() public {
        pool.setOvercharge(1);
        uint256 expected = fund.quoteUsdtInWars(10e6);
        vm.prank(agent);
        vm.expectRevert(Fund.SwapOverpayment.selector);
        fund.convert(10e6, expected * 99 / 100);
    }

    // ...nor collect twice in the same conversion.
    function test_poolCannotCollectTwice() public {
        pool.setCollectTwice(true);
        uint256 expected = fund.quoteUsdtInWars(10e6);
        vm.prank(agent);
        vm.expectRevert(Fund.OnlyPool.selector);
        fund.convert(10e6, expected * 99 / 100);
    }

    /// New fund on a pool that, in the middle of the swap, lets a third party call the fund's callback.
    function _fundWithHostilePool() internal returns (Attacker attacker) {
        MockPoolHostile hostile = new MockPoolHostile(address(wars), address(usdt), -350142);
        wars.mint(address(hostile), 1_000_000_000e18);
        pool = MockPool(address(hostile));
        fund = _newFund(_params());
        _contributeUsdt(members[0], 50e6);
        attacker = hostile.attacker();
    }

    // Final review: while the conversion runs (`_swapUsdtLimit` set), only the pool can collect through the callback.
    function test_nonPoolCannotCollectDuringTheConversion() public {
        _fundWithHostilePool();
        uint256 expected = fund.quoteUsdtInWars(10e6);
        vm.prank(agent);
        vm.expectRevert(Fund.OnlyPool.selector);
        fund.convert(10e6, expected * 99 / 100);
    }

    function test_thirdPartyDuringTheConversionCannotTakeTheFundUsdt() public {
        Attacker attacker = _fundWithHostilePool();
        attacker.setSwallowError(true);
        uint256 expected = fund.quoteUsdtInWars(10e6);
        vm.prank(agent);
        fund.convert(10e6, expected * 99 / 100);
        assertEq(attacker.lastError(), abi.encodeWithSelector(Fund.OnlyPool.selector));
        assertEq(usdt.balanceOf(address(fund)), 40e6); // it only paid the swap's 10 USDT
        assertEq(usdt.balanceOf(address(pool)), 10e6);
    }
}
