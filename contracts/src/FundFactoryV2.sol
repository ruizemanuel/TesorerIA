// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {FundV2} from "./FundV2.sol";

/// @title TesorerIA fund factory, version 2
/// @notice Creates one `FundV2` per group, each in the currency its group picks. It has no owner and no
///         administration functions: its Uniswap factory and the recipient of every fund's fee are fixed at deployment.
contract FundFactoryV2 {
    error InvalidParams();
    error InvalidPool();

    event FundCreated(
        address indexed fund, address indexed creator, address indexed currency, address dollar, string name
    );

    IUniswapV3Factory public immutable uniswapFactory;
    address public immutable feeRecipient;
    address[] public funds;

    constructor(IUniswapV3Factory uniswapFactory_, address feeRecipient_) {
        if (address(uniswapFactory_) == address(0) || feeRecipient_ == address(0)) revert InvalidParams();
        uniswapFactory = uniswapFactory_;
        feeRecipient = feeRecipient_;
    }

    /// @notice Creates a fund. With a dollar entry, its pool must be the one Uniswap's factory has for the currency and
    ///         the dollar at the pool's fee tier, and it must be able to serve a TWAP from the first day.
    function createFund(FundV2.Params calldata p) external returns (address fund) {
        // The fund validates its own shape first, so the pool is only read once it is known to be consistent.
        FundV2 created = new FundV2(p, feeRecipient);
        if (address(p.dollar) != address(0)) _checkPool(p.currency, p.dollar, p.pool, created.TWAP_WINDOW());
        fund = address(created);
        funds.push(fund);
        emit FundCreated(fund, msg.sender, address(p.currency), address(p.dollar), p.name);
    }

    function fundCount() external view returns (uint256) {
        return funds.length;
    }

    /// @dev `twapWindow` is the fund's own `TWAP_WINDOW`, so the check asks the pool for exactly what the fund will.
    function _checkPool(IERC20 currency, IERC20 dollar, IUniswapV3Pool pool, uint32 twapWindow) private view {
        if (uniswapFactory.getPool(address(currency), address(dollar), pool.fee()) != address(pool)) {
            revert InvalidPool();
        }
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        try pool.observe(secondsAgos) returns (int56[] memory, uint160[] memory) {}
        catch {
            revert InvalidPool();
        }
    }
}
