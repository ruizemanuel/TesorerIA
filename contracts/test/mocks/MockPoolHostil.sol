// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3SwapCallback} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {MockPool} from "./MockPool.sol";

/// Tercero que, en medio de una conversión, llama la callback del fondo para que le pague al pool de más.
contract Atacante {
    /// Si es true, se guarda el revert de la callback en vez de propagarlo, y la conversión sigue.
    bool public tragarError;
    bytes public ultimoError;

    function setTragarError(bool t) external {
        tragarError = t;
    }

    function atacar(address fondo, int256 amount0Delta, int256 amount1Delta) external {
        if (!tragarError) {
            IUniswapV3SwapCallback(fondo).uniswapV3SwapCallback(amount0Delta, amount1Delta, "");
            return;
        }
        try IUniswapV3SwapCallback(fondo).uniswapV3SwapCallback(amount0Delta, amount1Delta, "") {}
        catch (bytes memory e) {
            ultimoError = e;
        }
    }
}

/// Pool que, durante el swap y antes de cobrar, deja correr al `atacante`: hace las veces de cualquier código ajeno
/// que corra mientras el fondo convierte (por ejemplo, un hook que un token actualizable sume en una transferencia).
contract MockPoolHostil is MockPool {
    Atacante public immutable atacante = new Atacante();

    constructor(address tokenA, address tokenB, int24 tick_) MockPool(tokenA, tokenB, tick_) {}

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 limite, bytes calldata data)
        public
        override
        returns (int256, int256)
    {
        // Pide todo el USDT del fondo menos lo que cuesta el swap, así la conversión igual podría cerrar.
        address tokenIn = zeroForOne ? token0 : token1;
        int256 resto = int256(IERC20(tokenIn).balanceOf(msg.sender)) - amountSpecified;
        (int256 d0, int256 d1) = zeroForOne ? (resto, int256(0)) : (int256(0), resto);
        atacante.atacar(msg.sender, d0, d1);
        return super.swap(recipient, zeroForOne, amountSpecified, limite, data);
    }
}
