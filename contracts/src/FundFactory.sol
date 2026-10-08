// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {Fund} from "./Fund.sol";

/// @title TesorerIA fund factory
/// @notice Creates one `Fund` per group, always with the same wARS, USDT and pool.
contract FundFactory {
    error InvalidPool();

    event FundCreated(address indexed fund, address indexed creator, string name);

    IERC20 public immutable wars;
    IERC20 public immutable usdt;
    IUniswapV3Pool public immutable pool;
    address[] public funds;

    constructor(IERC20 wars_, IERC20 usdt_, IUniswapV3Pool pool_) {
        address t0 = pool_.token0();
        address t1 = pool_.token1();
        bool ok = (t0 == address(wars_) && t1 == address(usdt_)) || (t0 == address(usdt_) && t1 == address(wars_));
        if (!ok) revert InvalidPool();
        wars = wars_;
        usdt = usdt_;
        pool = pool_;
    }

    function createFund(Fund.Params calldata p) external returns (address fund) {
        fund = address(new Fund(wars, usdt, pool, p));
        funds.push(fund);
        emit FundCreated(fund, msg.sender, p.name);
    }

    function fundCount() external view returns (uint256) {
        return funds.length;
    }
}
