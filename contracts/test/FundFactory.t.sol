// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";
import {FundFactory} from "../src/FundFactory.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

contract FundFactoryTest is BaseFundTest {
    FundFactory factory;

    function setUp() public override {
        super.setUp();
        factory = new FundFactory(IERC20(address(wars)), IERC20(address(usdt)), IUniswapV3Pool(address(pool)));
    }

    function test_createsAFundWithTheParams() public {
        vm.prank(members[0]);
        address created = factory.createFund(_params());
        assertEq(factory.fundCount(), 1);
        assertEq(factory.funds(0), created);
        Fund f = Fund(created);
        assertEq(f.name(), "Thursday football");
        assertEq(address(f.wars()), address(wars));
        assertEq(address(f.pool()), address(pool));
        assertEq(f.members().length, 5);
    }

    function test_emitsFundCreated() public {
        vm.expectEmit(false, true, false, true, address(factory));
        emit FundFactory.FundCreated(address(0), members[0], "Thursday football");
        vm.prank(members[0]);
        factory.createFund(_params());
    }

    function test_invalidParamsRevert() public {
        Fund.Params memory p = _params();
        p.votesRequired = 9;
        vm.expectRevert(Fund.InvalidParams.selector);
        factory.createFund(p);
    }

    function test_poolOfOtherTokensReverts() public {
        MockERC20 other = new MockERC20("OTHER", "OTHER", 18);
        MockPool bad = new MockPool(address(other), address(usdt), 0);
        vm.expectRevert(FundFactory.InvalidPool.selector);
        new FundFactory(IERC20(address(wars)), IERC20(address(usdt)), IUniswapV3Pool(address(bad)));
    }
}
