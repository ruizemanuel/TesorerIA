// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

/// Fake Uniswap v3 factory: only the pools registered with `setPool` exist, and the token order doesn't matter.
contract MockUniswapV3Factory {
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        getPool[tokenA][tokenB][fee] = pool;
        getPool[tokenB][tokenA][fee] = pool;
    }
}
