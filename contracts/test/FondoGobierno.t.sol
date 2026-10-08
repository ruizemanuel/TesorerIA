// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fondo.sol";

contract FondoGobiernoTest is BaseFondoTest {
    address nuevo = makeAddr("nuevo");

    function setUp() public override {
        super.setUp();
        _aportarWars(miembros[0], 30_000e18);
        _aportarWars(miembros[1], 10_000e18);
        _aportarUsdt(miembros[1], 10e6); // ≈ 16.058,8 wARS
    }

    function _aprobado(Fondo.Accion acc, address a, address b, uint256 monto) internal returns (uint256 id) {
        id = _proponer(miembros[0], acc, a, b, monto);
        _aprobar(id, 1, 3);
        fondo.ejecutar(id);
    }

    function test_agregarMiembro() public {
        _aprobado(Fondo.Accion.AgregarMiembro, nuevo, address(0), 0);
        assertTrue(fondo.esMiembro(nuevo));
        assertEq(fondo.miembros().length, 6);
        assertEq(fondo.aportado(nuevo), 0);
    }

    function test_noSeAgregaAlAgenteNiAUnMiembro() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.AgregarMiembro, agente, address(0), 0);
        _aprobar(id, 1, 3);
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        fondo.ejecutar(id);
        id = _proponer(miembros[0], Fondo.Accion.AgregarMiembro, miembros[2], address(0), 0);
        _aprobar(id, 1, 3);
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        fondo.ejecutar(id);
    }

    function test_sacarMiembroLeDevuelveSuParte() public {
        uint256 totalAntes = fondo.totalAportado();
        uint256 aporteM1 = fondo.aportado(miembros[1]);
        uint256 warsEsperado = wars.balanceOf(address(fondo)) * aporteM1 / totalAntes;
        uint256 usdtEsperado = usdt.balanceOf(address(fondo)) * aporteM1 / totalAntes;
        _aprobado(Fondo.Accion.SacarMiembro, miembros[1], address(0), 0);
        assertFalse(fondo.esMiembro(miembros[1]));
        assertEq(fondo.miembros().length, 4);
        assertEq(wars.balanceOf(miembros[1]), warsEsperado);
        assertEq(usdt.balanceOf(miembros[1]), usdtEsperado);
        assertEq(fondo.aportado(miembros[1]), 0);
        assertEq(fondo.totalAportado(), totalAntes - aporteM1);
    }

    function test_noSePuedeSacarSiNQuedariaMayorQueLosMiembros() public {
        _aprobado(Fondo.Accion.CambiarVotos, address(0), address(0), 5);
        uint256 id = _proponer(miembros[0], Fondo.Accion.SacarMiembro, miembros[4], address(0), 0);
        _aprobar(id, 1, 5);
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        fondo.ejecutar(id);
    }

    function test_cambiarMiembroMueveLoAportado() public {
        uint256 aporte = fondo.aportado(miembros[0]);
        _aprobado(Fondo.Accion.CambiarMiembro, miembros[0], nuevo, 0);
        assertFalse(fondo.esMiembro(miembros[0]));
        assertTrue(fondo.esMiembro(nuevo));
        assertEq(fondo.aportado(nuevo), aporte);
        assertEq(fondo.aportado(miembros[0]), 0);
        assertEq(fondo.miembros().length, 5);
    }

    function test_cambiarTope() public {
        _aprobado(Fondo.Accion.CambiarTope, address(0), address(0), 80_000e18);
        assertEq(fondo.topeSemanal(), 80_000e18);
    }

    function test_cambiarVotosFueraDeRangoRevierte() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.CambiarVotos, address(0), address(0), 1);
        _aprobar(id, 1, 3);
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        fondo.ejecutar(id);
    }

    // Review Focus 4: al ejecutar se usa el N actual.
    function test_ejecutarUsaLosVotosNecesariosActuales() public {
        uint256 pago = _proponer(miembros[0], Fondo.Accion.Pagar, miembros[2], 1_000e18);
        _aprobar(pago, 1, 3); // 3 votos: alcanzaba con N = 3
        _aprobado(Fondo.Accion.CambiarVotos, address(0), address(0), 4);
        vm.expectRevert(Fondo.VotosInsuficientes.selector);
        fondo.ejecutar(pago);
        _aprobar(pago, 3, 4);
        fondo.ejecutar(pago);
        assertEq(wars.balanceOf(miembros[2]), 1_000e18);
    }

    // Review Focus 2: si el destinatario dejó de ser miembro, el pago revierte.
    function test_pagoAMiembroSacadoRevierte() public {
        uint256 pago = _proponer(miembros[0], Fondo.Accion.Pagar, miembros[2], 1_000e18);
        _aprobar(pago, 1, 2);
        _aprobado(Fondo.Accion.SacarMiembro, miembros[2], address(0), 0);
        _aprobar(pago, 3, 4);
        vm.expectRevert(Fondo.DestinoNoMiembro.selector);
        fondo.ejecutar(pago);
    }

    // Review Focus 5: con el agente despedido, sus funciones revierten y el grupo sigue operando.
    function test_agenteDespedidoNoPuedeOperar() public {
        _aprobado(Fondo.Accion.CambiarAgente, address(0), address(0), 0);
        assertEq(fondo.agente(), address(0));
        vm.prank(agente);
        vm.expectRevert(Fondo.SoloAgente.selector);
        fondo.reintegrarGastoAcordado(miembros[0], 1e18, bytes32(0));
        vm.prank(agente);
        vm.expectRevert(Fondo.SoloAgente.selector);
        fondo.convertir(1e6, 1);
        vm.prank(agente);
        vm.expectRevert(Fondo.SoloMiembroOAgente.selector);
        fondo.proponer(Fondo.Accion.Pagar, miembros[0], address(0), 1e18, "x");
        _aprobado(Fondo.Accion.Pagar, miembros[3], address(0), 1_000e18);
        assertEq(wars.balanceOf(miembros[3]), 1_000e18);
    }

    function test_reemplazarAgente() public {
        _aprobado(Fondo.Accion.CambiarAgente, nuevo, address(0), 0);
        assertEq(fondo.agente(), nuevo);
        vm.prank(nuevo);
        fondo.reintegrarGastoAcordado(miembros[0], 1_000e18, bytes32(0));
    }

    function test_elNuevoAgenteNoPuedeSerMiembro() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.CambiarAgente, miembros[3], address(0), 0);
        _aprobar(id, 1, 3);
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        fondo.ejecutar(id);
    }
}
