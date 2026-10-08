// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {Fondo} from "./Fund.sol";

/// @title Fábrica de fondos de TesorerIA
/// @notice Crea un `Fondo` por grupo, siempre con el mismo wARS, USDT y pool.
contract FabricaFondos {
    error PoolInvalido();

    event FondoCreado(address indexed fondo, address indexed creador, string nombre);

    IERC20 public immutable wars;
    IERC20 public immutable usdt;
    IUniswapV3Pool public immutable pool;
    address[] public fondos;

    constructor(IERC20 wars_, IERC20 usdt_, IUniswapV3Pool pool_) {
        address t0 = pool_.token0();
        address t1 = pool_.token1();
        bool ok = (t0 == address(wars_) && t1 == address(usdt_)) || (t0 == address(usdt_) && t1 == address(wars_));
        if (!ok) revert PoolInvalido();
        wars = wars_;
        usdt = usdt_;
        pool = pool_;
    }

    function crearFondo(Fondo.Parametros calldata p) external returns (address fondo) {
        fondo = address(new Fondo(wars, usdt, pool, p));
        fondos.push(fondo);
        emit FondoCreado(fondo, msg.sender, p.nombre);
    }

    function cantidadFondos() external view returns (uint256) {
        return fondos.length;
    }
}
