// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";
import {FundFactoryV2} from "../../src/FundFactoryV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

contract FundV2CreationTest is BaseFundV2Test {
    // ---------------------------------------------------------------- What gets created
    function test_createsFundWithCurrencyDollarAndFee() public view {
        assertEq(address(fund.currency()), address(currency));
        assertEq(address(fund.dollar()), address(dollar));
        assertEq(address(fund.pool()), address(pool));
        assertEq(fund.feeBps(), 25);
        assertEq(fund.feeRecipient(), feeRecipient);
        assertEq(factory.fundCount(), 1);
        assertEq(factory.funds(0), address(fund));
    }

    function test_storesTheParams() public view {
        assertEq(fund.name(), "Thursday football");
        assertEq(fund.agreedExpense(), "Pitch");
        assertEq(fund.weeklyCap(), WEEKLY_CAP);
        assertEq(fund.balanceCap(), BALANCE_CAP);
        assertEq(fund.votesRequired(), 3);
        assertEq(fund.agent(), agent);
        assertEq(fund.members().length, 5);
        for (uint256 i; i < 5; ++i) {
            assertEq(fund.members()[i], members[i]);
            assertTrue(fund.isMember(members[i]));
        }
        assertFalse(fund.isMember(agent));
        assertEq(fund.startTime(), block.timestamp);
        assertFalse(fund.closed());
        assertEq(fund.feeOwed(), 0);
        assertEq(fund.totalContributed(), 0);
        assertEq(fund.totalPendingDollar(), 0);
    }

    function test_emitsFundCreated() public {
        address predicted = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        vm.expectEmit(true, true, true, true, address(factory));
        emit FundFactoryV2.FundCreated(
            predicted, address(this), address(currency), address(dollar), "Thursday football"
        );
        FundV2 created = _create(_params());
        assertEq(address(created), predicted);
    }

    function test_createsFundWithoutDollar() public {
        FundV2 f = _create(_paramsNoDollar());
        assertEq(address(f.currency()), address(currency));
        assertEq(address(f.dollar()), address(0));
        assertEq(address(f.pool()), address(0));
        assertEq(factory.fundCount(), 2);
        assertEq(factory.funds(1), address(f));
    }

    function test_weeksAreSevenDayWindows() public {
        uint256 start = fund.startTime();
        assertEq(fund.currentWeek(), 0);
        vm.warp(start + 7 days - 1);
        assertEq(fund.currentWeek(), 0);
        vm.warp(start + 7 days);
        assertEq(fund.currentWeek(), 1);
    }

    // ---------------------------------------------------------------- Currency, dollar and pool
    function test_rejectsZeroCurrency() public {
        FundV2.Params memory p = _params();
        p.currency = IERC20(address(0));
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        p = _paramsNoDollar();
        p.currency = IERC20(address(0));
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);
    }

    function test_rejectsDollarWithoutPool() public {
        FundV2.Params memory p = _params();
        p.pool = IUniswapV3Pool(address(0));
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);
    }

    function test_rejectsPoolWithoutDollar() public {
        FundV2.Params memory p = _params();
        p.dollar = IERC20(address(0));
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);
    }

    function test_rejectsDollarEqualToCurrency() public {
        FundV2.Params memory p = _params();
        p.dollar = p.currency;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);
    }

    function test_rejectsPoolOfOtherTokens() public {
        MockERC20 other = new MockERC20("OTHER", "OTHER", 18);
        MockPool otherPool = new MockPool(address(currency), address(other), 0);
        uniFactory.setPool(address(currency), address(other), otherPool.fee(), address(otherPool));
        FundV2.Params memory p = _params();
        p.pool = IUniswapV3Pool(address(otherPool));
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);
    }

    function test_rejectsPoolNotFromUniswapFactory() public {
        // Same tokens, same fee, but the Uniswap factory doesn't know it.
        MockPool impostor = new MockPool(address(currency), address(dollar), -350142);
        FundV2.Params memory p = _params();
        p.pool = IUniswapV3Pool(address(impostor));
        vm.expectRevert(FundFactoryV2.InvalidPool.selector);
        _create(p);
    }

    function test_rejectsPoolWhoseTwapReverts() public {
        pool.setObserveReverts(true);
        vm.expectRevert(FundFactoryV2.InvalidPool.selector);
        _create(_params());
    }

    function test_noDollarFundNeverReadsThePool() public {
        // A pool that can't serve a TWAP (a history younger than the window) doesn't matter without a dollar.
        pool.setObserveReverts(true);
        FundV2 f = _create(_paramsNoDollar());
        assertEq(address(f.pool()), address(0));
    }

    // ---------------------------------------------------------------- Fee and caps
    function test_rejectsFeeAboveMax() public {
        FundV2.Params memory p = _params();
        p.feeBps = 101;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        p.feeBps = 100;
        assertEq(_create(p).feeBps(), 100);
    }

    function test_acceptsZeroFee() public {
        FundV2.Params memory p = _params();
        p.feeBps = 0;
        assertEq(_create(p).feeBps(), 0);
    }

    function test_rejectsWeeklyCapAboveBalanceCap() public {
        FundV2.Params memory p = _params();
        p.weeklyCap = BALANCE_CAP + 1;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        p.weeklyCap = BALANCE_CAP;
        assertEq(_create(p).weeklyCap(), BALANCE_CAP);
    }

    function test_rejectsZeroBalanceCap() public {
        FundV2.Params memory p = _params();
        p.balanceCap = 0;
        p.weeklyCap = 0;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);
    }

    // ---------------------------------------------------------------- Agent and members
    function test_rejectsZeroAgent() public {
        FundV2.Params memory p = _params();
        p.agent = address(0);
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);
    }

    /// The fund can't be its own agent or one of its members, as `SetAgent` and adding or replacing a member already
    /// require. Its address is known before it exists: it is the next one the factory creates.
    function test_rejectsTheFundItselfAsAgentOrMember() public {
        address predicted = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));

        FundV2.Params memory p = _params();
        p.agent = predicted;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        p = _params();
        p.members[2] = predicted;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        // The prediction is right: a fund that doesn't name itself gets that address.
        assertEq(address(_create(_params())), predicted);
    }

    function test_membersRulesAsV1() public {
        FundV2.Params memory p = _params();

        // Fewer than 3 members.
        address[] memory two = new address[](2);
        two[0] = members[0];
        two[1] = members[1];
        p.members = two;
        p.votesRequired = 2;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        // More than 10 members.
        address[] memory eleven = new address[](11);
        for (uint256 i; i < 11; ++i) {
            eleven[i] = address(uint160(1000 + i));
        }
        p = _params();
        p.members = eleven;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        // A duplicate member.
        p = _params();
        p.members[4] = p.members[0];
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        // The zero address as a member.
        p = _params();
        p.members[2] = address(0);
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        // The agent as a member.
        p = _params();
        p.agent = members[1];
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        // Fewer than 2 votes.
        p = _params();
        p.votesRequired = 1;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);

        // As many votes as members: one lost passkey would lock the fund forever.
        p = _params();
        p.votesRequired = 5;
        vm.expectRevert(FundV2.InvalidParams.selector);
        _create(p);
    }

    function test_acceptsTheMemberBounds() public {
        FundV2.Params memory p = _params();
        address[] memory three = new address[](3);
        for (uint256 i; i < 3; ++i) {
            three[i] = members[i];
        }
        p.members = three;
        p.votesRequired = 2;
        FundV2 f = _create(p);
        assertEq(f.members().length, 3);
        assertEq(f.votesRequired(), 2);

        address[] memory ten = new address[](10);
        for (uint256 i; i < 10; ++i) {
            ten[i] = makeAddr(string.concat("tenth", vm.toString(i)));
        }
        p.members = ten;
        p.votesRequired = 9;
        f = _create(p);
        assertEq(f.members().length, 10);
        assertEq(f.votesRequired(), 9);
    }

    // ---------------------------------------------------------------- The factory
    function test_factoryRejectsZeroAddresses() public {
        vm.expectRevert(FundFactoryV2.InvalidParams.selector);
        new FundFactoryV2(IUniswapV3Factory(address(0)), feeRecipient);

        vm.expectRevert(FundFactoryV2.InvalidParams.selector);
        new FundFactoryV2(IUniswapV3Factory(address(uniFactory)), address(0));
    }

    function test_factoryStoresItsConfig() public view {
        assertEq(address(factory.uniswapFactory()), address(uniFactory));
        assertEq(factory.feeRecipient(), feeRecipient);
    }
}
