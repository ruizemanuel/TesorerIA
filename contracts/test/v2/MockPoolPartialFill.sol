// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {MockPool} from "../mocks/MockPool.sol";

/// Pool that fills only `fillBps` of what a swap asks for, as a real Uniswap v3 pool does when an exact-input swap
/// runs out of in-range liquidity before its price limit: it takes less of the input and delivers proportionally less.
contract MockPoolPartialFill is MockPool {
    uint256 public fillBps = 10_000;

    constructor(address tokenA, address tokenB, int24 tick_) MockPool(tokenA, tokenB, tick_) {}

    function setFill(uint256 bps) external {
        fillBps = bps;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 limit, bytes calldata data)
        public
        override
        returns (int256, int256)
    {
        return super.swap(recipient, zeroForOne, amountSpecified * int256(fillBps) / 10_000, limit, data);
    }
}
