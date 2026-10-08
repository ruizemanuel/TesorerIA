// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fondo.sol";

contract FondoConversionTest is BaseFondoTest {
    function setUp() public override {
        super.setUp();
        _aportarUsdt(miembros[0], 50e6);
    }

    function test_agenteConvierteAlPrecioDelPool() public {
        uint256 esperado = fondo.cotizarUsdtEnWars(30e6);
        vm.prank(agente);
        uint256 recibido = fondo.convertir(30e6, esperado * 99 / 100);
        assertApproxEqRel(recibido, esperado, 0.0001e18);
        assertEq(usdt.balanceOf(address(fondo)), 20e6);
        assertEq(wars.balanceOf(address(fondo)), recibido);
    }

    function test_emiteConversion() public {
        uint256 esperado = fondo.cotizarUsdtEnWars(10e6);
        vm.expectEmit(false, false, false, false, address(fondo));
        emit Fondo.Conversion(10e6, esperado);
        vm.prank(agente);
        fondo.convertir(10e6, esperado * 99 / 100);
    }

    function test_soloElAgentePuedeConvertir() public {
        vm.prank(miembros[0]);
        vm.expectRevert(Fondo.SoloAgente.selector);
        fondo.convertir(10e6, 1);
    }

    function test_minimoPorDebajoDelMargenRevierte() public {
        uint256 esperado = fondo.cotizarUsdtEnWars(10e6);
        vm.prank(agente);
        vm.expectRevert(Fondo.MinimoMuyBajo.selector);
        fondo.convertir(10e6, esperado * 97 / 100);
    }

    function test_siElPoolEntregaMenosQueElMinimoRevierte() public {
        uint256 esperado = fondo.cotizarUsdtEnWars(10e6);
        pool.setCalidad(9_850); // entrega 1,5 % menos
        vm.prank(agente);
        vm.expectRevert(Fondo.RecibidoInsuficiente.selector);
        fondo.convertir(10e6, esperado * 99 / 100);
    }

    function test_noPuedeConvertirMasUsdtDelQueHay() public {
        vm.prank(agente);
        vm.expectRevert(Fondo.SaldoInsuficiente.selector);
        fondo.convertir(51e6, 1);
    }

    function test_callbackFueraDeUnaConversionRevierte() public {
        vm.prank(address(pool));
        vm.expectRevert(Fondo.SoloPool.selector);
        fondo.uniswapV3SwapCallback(0, 1e6, "");
    }

    function test_callbackDeOtroQueNoEsElPoolRevierte() public {
        vm.prank(ajeno);
        vm.expectRevert(Fondo.SoloPool.selector);
        fondo.uniswapV3SwapCallback(0, 1e6, "");
    }
}
