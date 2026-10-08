// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {Fondo} from "../src/Fondo.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPool} from "./mocks/MockPool.sol";

abstract contract BaseFondoTest is Test {
    MockERC20 internal wars;
    MockERC20 internal usdt;
    MockPool internal pool;
    Fondo internal fondo;

    address internal agente = makeAddr("agente");
    address internal ajeno = makeAddr("ajeno");
    address[] internal miembros;

    uint256 internal constant TOPE_SEMANAL = 60_000e18;
    uint256 internal constant TOPE_TOTAL = 450_000e18;

    function setUp() public virtual {
        usdt = new MockERC20("USDT", "USDT", 6);
        wars = new MockERC20("wARS", "wARS", 18);
        require(address(wars) < address(usdt), "wARS tiene que ser token0, como en Celo");
        // Orientación real del pool: token0 = wARS, tick -350142.
        int24 tick = -350142;
        pool = new MockPool(address(wars), address(usdt), tick);
        wars.mint(address(pool), 1_000_000_000e18);
        usdt.mint(address(pool), 1_000_000e6);
        for (uint256 i; i < 5; ++i) {
            miembros.push(makeAddr(string.concat("miembro", vm.toString(i))));
        }
        fondo = _nuevoFondo(_params());
    }

    function _params() internal view returns (Fondo.Parametros memory p) {
        p.nombre = "Futbol de los jueves";
        p.miembros = miembros;
        p.votosNecesarios = 3;
        p.agente = agente;
        p.gastoAcordado = "Cancha";
        p.topeSemanal = TOPE_SEMANAL;
        p.topeSaldoTotal = TOPE_TOTAL;
    }

    function _nuevoFondo(Fondo.Parametros memory p) internal returns (Fondo) {
        return new Fondo(IERC20(address(wars)), IERC20(address(usdt)), IUniswapV3Pool(address(pool)), p);
    }
}
