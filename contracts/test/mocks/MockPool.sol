// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import {IUniswapV3SwapCallback} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";

/// Pool falso con precio fijo: el TWAP siempre es `tick`, y el swap entrega según ese tick por `calidadBps`.
contract MockPool {
    address public immutable token0;
    address public immutable token1;
    int24 public tick;
    uint256 public calidadBps = 10_000;

    constructor(address tokenA, address tokenB, int24 tick_) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        tick = tick_;
    }

    function setTick(int24 t) external {
        tick = t;
    }

    function setCalidad(uint256 bps) external {
        calidadBps = bps;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; ++i) {
            tickCumulatives[i] = -int56(tick) * int56(uint56(secondsAgos[i]));
        }
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "solo exact input");
        address tokenIn = zeroForOne ? token0 : token1;
        address tokenOut = zeroForOne ? token1 : token0;
        uint256 amountIn = uint256(amountSpecified);
        uint256 out = OracleLibrary.getQuoteAtTick(tick, uint128(amountIn), tokenIn, tokenOut) * calidadBps / 10_000;
        IERC20(tokenOut).transfer(recipient, out);
        (amount0, amount1) = zeroForOne ? (int256(amountIn), -int256(out)) : (-int256(out), int256(amountIn));
        uint256 antes = IERC20(tokenIn).balanceOf(address(this));
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        require(IERC20(tokenIn).balanceOf(address(this)) >= antes + amountIn, "no pago");
    }
}
