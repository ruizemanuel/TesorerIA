// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3SwapCallback} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {MockPool} from "./MockPool.sol";

/// Third party that, in the middle of a conversion, calls the fund's callback so that it overpays the pool.
contract Attacker {
    /// If true, the callback's revert is stored instead of bubbled up, and the conversion goes on.
    bool public swallowError;
    bytes public lastError;

    function setSwallowError(bool t) external {
        swallowError = t;
    }

    function attack(address fund, int256 amount0Delta, int256 amount1Delta) external {
        if (!swallowError) {
            IUniswapV3SwapCallback(fund).uniswapV3SwapCallback(amount0Delta, amount1Delta, "");
            return;
        }
        try IUniswapV3SwapCallback(fund).uniswapV3SwapCallback(amount0Delta, amount1Delta, "") {}
        catch (bytes memory e) {
            lastError = e;
        }
    }
}

/// Pool that, during the swap and before collecting, lets the `attacker` run: it stands in for any outside code
/// that runs while the fund converts (for example, a hook that an upgradeable token adds to transfers).
contract MockPoolHostile is MockPool {
    Attacker public immutable attacker = new Attacker();

    constructor(address tokenA, address tokenB, int24 tick_) MockPool(tokenA, tokenB, tick_) {}

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 limit, bytes calldata data)
        public
        override
        returns (int256, int256)
    {
        // Asks for all of the fund's USDT minus what the swap costs, so the conversion could still go through.
        address tokenIn = zeroForOne ? token0 : token1;
        int256 rest = int256(IERC20(tokenIn).balanceOf(msg.sender)) - amountSpecified;
        (int256 d0, int256 d1) = zeroForOne ? (rest, int256(0)) : (int256(0), rest);
        attacker.attack(msg.sender, d0, d1);
        return super.swap(recipient, zeroForOne, amountSpecified, limit, data);
    }
}
