// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fondo.sol";

contract FondoReintegroTest is BaseFondoTest {
    bytes32 constant REF = keccak256("gasto-1");

    function setUp() public override {
        super.setUp();
        _aportarWars(miembros[1], 200_000e18);
    }

    function test_reintegraDentroDelTope() public {
        vm.expectEmit(true, false, false, true, address(fondo));
        emit Fondo.Reintegro(miembros[0], 45_000e18, REF, 0);
        vm.prank(agente);
        fondo.reintegrarGastoAcordado(miembros[0], 45_000e18, REF);
        assertEq(wars.balanceOf(miembros[0]), 45_000e18);
        assertEq(fondo.gastadoEnSemana(0), 45_000e18);
    }

    function test_superarElTopeDeLaSemanaRevierte() public {
        vm.startPrank(agente);
        fondo.reintegrarGastoAcordado(miembros[0], 45_000e18, REF);
        vm.expectRevert(Fondo.TopeSemanalSuperado.selector);
        fondo.reintegrarGastoAcordado(miembros[2], 15_001e18, REF);
        vm.stopPrank();
    }

    function test_topeSeReiniciaEnLaSemanaSiguiente() public {
        vm.prank(agente);
        fondo.reintegrarGastoAcordado(miembros[0], 60_000e18, REF);
        vm.warp(fondo.inicio() + 7 days);
        vm.prank(agente);
        fondo.reintegrarGastoAcordado(miembros[0], 60_000e18, REF);
        assertEq(fondo.gastadoEnSemana(0), 60_000e18);
        assertEq(fondo.gastadoEnSemana(1), 60_000e18);
    }

    function test_soloAMiembros() public {
        vm.prank(agente);
        vm.expectRevert(Fondo.DestinoNoMiembro.selector);
        fondo.reintegrarGastoAcordado(ajeno, 1e18, REF);
    }

    function test_soloElAgente() public {
        vm.prank(miembros[0]);
        vm.expectRevert(Fondo.SoloAgente.selector);
        fondo.reintegrarGastoAcordado(miembros[0], 1e18, REF);
    }

    function test_sinSaldoEnWarsRevierte() public {
        Fondo vacio = _nuevoFondo(_params());
        vm.prank(agente);
        vm.expectRevert(Fondo.SaldoInsuficiente.selector);
        vacio.reintegrarGastoAcordado(miembros[0], 1e18, REF);
    }

    function testFuzz_laSumaSemanalNuncaPasaElTope(uint256[6] memory montos) public {
        uint256 suma;
        for (uint256 i; i < montos.length; ++i) {
            uint256 m = bound(montos[i], 1, 30_000e18);
            vm.prank(agente);
            if (suma + m > TOPE_SEMANAL) {
                vm.expectRevert(Fondo.TopeSemanalSuperado.selector);
                fondo.reintegrarGastoAcordado(miembros[0], m, REF);
            } else {
                fondo.reintegrarGastoAcordado(miembros[0], m, REF);
                suma += m;
            }
        }
        assertLe(fondo.gastadoEnSemana(0), TOPE_SEMANAL);
        assertEq(fondo.gastadoEnSemana(0), suma);
    }
}
