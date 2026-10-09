// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import {IUniswapV3SwapCallback} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";

/// Fake pool with a fixed price: the TWAP is always `tick` (except for `cumulativeOffset`, to test rounding), and the swap delivers at that tick times `qualityBps`.
contract MockPool {
    address public immutable token0;
    address public immutable token1;
    int24 public tick;
    uint256 public qualityBps = 10_000;
    int56 public cumulativeOffset;
    /// Extra amount the pool asks for in the callback, on top of the swap's input.
    uint256 public overcharge;
    /// If true, the pool calls the callback twice.
    bool public collectTwice;

    constructor(address tokenA, address tokenB, int24 tick_) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        tick = tick_;
    }

    function setTick(int24 t) external {
        tick = t;
    }

    function setQuality(uint256 bps) external {
        qualityBps = bps;
    }

    function setCumulativeOffset(int56 a) external {
        cumulativeOffset = a;
    }

    function setOvercharge(uint256 extra) external {
        overcharge = extra;
    }

    function setCollectTwice(bool t) external {
        collectTwice = t;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; ++i) {
            tickCumulatives[i] = -int56(tick) * int56(uint56(secondsAgos[i]))
                - (secondsAgos[i] > 0 ? cumulativeOffset : int56(0));
        }
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        public
        virtual
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "exact input only");
        address tokenIn = zeroForOne ? token0 : token1;
        address tokenOut = zeroForOne ? token1 : token0;
        uint256 amountIn = uint256(amountSpecified);
        uint256 out = OracleLibrary.getQuoteAtTick(tick, uint128(amountIn), tokenIn, tokenOut) * qualityBps / 10_000;
        IERC20(tokenOut).transfer(recipient, out);
        uint256 owed = amountIn + overcharge;
        (amount0, amount1) = zeroForOne ? (int256(owed), -int256(out)) : (-int256(out), int256(owed));
        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        if (collectTwice) IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        require(IERC20(tokenIn).balanceOf(address(this)) >= balanceBefore + owed, "not paid");
    }
}
