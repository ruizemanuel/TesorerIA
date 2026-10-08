// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fondo.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

contract FondoCreacionTest is BaseFondoTest {
    function test_guardaLosParametros() public view {
        assertEq(fondo.nombre(), "Futbol de los jueves");
        assertEq(fondo.gastoAcordado(), "Cancha");
        assertEq(fondo.topeSemanal(), TOPE_SEMANAL);
        assertEq(fondo.topeSaldoTotal(), TOPE_TOTAL);
        assertEq(fondo.votosNecesarios(), 3);
        assertEq(fondo.agente(), agente);
        assertEq(fondo.miembros().length, 5);
        for (uint256 i; i < 5; ++i) assertTrue(fondo.esMiembro(miembros[i]));
        assertFalse(fondo.esMiembro(agente));
        assertEq(fondo.inicio(), block.timestamp);
        assertFalse(fondo.cerrado());
    }

    function test_cotizaConElTwap() public view {
        assertApproxEqRel(fondo.cotizarUsdtEnWars(1e6), 1605.88e18, 0.001e18);
        assertEq(fondo.cotizarUsdtEnWars(0), 0);
    }

    function test_semanasSonVentanasDeSieteDias() public {
        assertEq(fondo.semanaActual(), 0);
        vm.warp(block.timestamp + 7 days - 1);
        assertEq(fondo.semanaActual(), 0);
        vm.warp(block.timestamp + 1);
        assertEq(fondo.semanaActual(), 1);
    }

    function test_revierteConMenosDeTresMiembros() public {
        Fondo.Parametros memory p = _params();
        address[] memory dos = new address[](2);
        dos[0] = miembros[0];
        dos[1] = miembros[1];
        p.miembros = dos;
        p.votosNecesarios = 2;
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        _nuevoFondo(p);
    }

    function test_revierteConMasDeDiezMiembros() public {
        Fondo.Parametros memory p = _params();
        address[] memory once = new address[](11);
        for (uint256 i; i < 11; ++i) once[i] = address(uint160(1000 + i));
        p.miembros = once;
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        _nuevoFondo(p);
    }

    function test_revierteConMiembroRepetido() public {
        Fondo.Parametros memory p = _params();
        p.miembros[4] = p.miembros[0];
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        _nuevoFondo(p);
    }

    function test_revierteConMiembroCero() public {
        Fondo.Parametros memory p = _params();
        p.miembros[2] = address(0);
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        _nuevoFondo(p);
    }

    function test_revierteSiElAgenteEsMiembro() public {
        Fondo.Parametros memory p = _params();
        p.agente = miembros[1];
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        _nuevoFondo(p);
    }

    function test_revierteConVotosFueraDeRango() public {
        Fondo.Parametros memory p = _params();
        p.votosNecesarios = 1;
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        _nuevoFondo(p);
        p.votosNecesarios = 6;
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        _nuevoFondo(p);
    }

    function test_revierteConTopeTotalCero() public {
        Fondo.Parametros memory p = _params();
        p.topeSaldoTotal = 0;
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        _nuevoFondo(p);
    }

    function test_revierteSiElPoolNoEsDeWarsYUsdt() public {
        MockERC20 otro = new MockERC20("OTRO", "OTRO", 18);
        MockPool malo = new MockPool(address(otro), address(usdt), 0);
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        new Fondo(IERC20(address(wars)), IERC20(address(usdt)), IUniswapV3Pool(address(malo)), _params());
    }
}
