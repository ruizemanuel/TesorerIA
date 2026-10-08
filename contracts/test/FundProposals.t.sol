// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fund.sol";

contract FondoPropuestasTest is BaseFondoTest {
    function setUp() public override {
        super.setUp();
        _aportarWars(miembros[0], 100_000e18);
    }

    function test_elProponenteMiembroVotaSolo() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.Pagar, miembros[1], 20_000e18);
        assertEq(id, 0);
        assertEq(fondo.cantidadPropuestas(), 1);
        assertTrue(fondo.votoDe(id, miembros[0]));
        assertEq(fondo.votosDe(id), 1);
    }

    function test_elAgentePuedeProponerPeroNoVota() public {
        uint256 id = _proponer(agente, Fondo.Accion.Pagar, miembros[1], 20_000e18);
        assertEq(fondo.votosDe(id), 0);
        vm.prank(agente);
        vm.expectRevert(Fondo.NoEsMiembro.selector);
        fondo.votar(id);
    }

    function test_unAjenoNoPuedeProponer() public {
        vm.prank(ajeno);
        vm.expectRevert(Fondo.SoloMiembroOAgente.selector);
        fondo.proponer(Fondo.Accion.Pagar, miembros[1], address(0), 1e18, "x");
    }

    function test_pagoConVotosSuficientesSeEjecuta() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.Pagar, miembros[1], 20_000e18);
        _aprobar(id, 1, 3); // miembros 1 y 2: con el proponente son 3
        vm.prank(ajeno);
        fondo.ejecutar(id);
        assertEq(wars.balanceOf(miembros[1]), 20_000e18);
        assertTrue(fondo.propuesta(id).ejecutada);
    }

    function test_sinVotosSuficientesNoSeEjecuta() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.Pagar, miembros[1], 20_000e18);
        _aprobar(id, 1, 2);
        vm.expectRevert(Fondo.VotosInsuficientes.selector);
        fondo.ejecutar(id);
    }

    function test_noSePuedeVotarDosVeces() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.Pagar, miembros[1], 1e18);
        vm.prank(miembros[0]);
        vm.expectRevert(Fondo.YaVoto.selector);
        fondo.votar(id);
    }

    function test_propuestaVencidaNoSeVotaNiSeEjecuta() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.Pagar, miembros[1], 1e18);
        _aprobar(id, 1, 2);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(miembros[2]);
        vm.expectRevert(Fondo.PropuestaVencida.selector);
        fondo.votar(id);
        vm.expectRevert(Fondo.PropuestaVencida.selector);
        fondo.ejecutar(id);
    }

    function test_noSeEjecutaDosVeces() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.Pagar, miembros[1], 1e18);
        _aprobar(id, 1, 3);
        fondo.ejecutar(id);
        vm.expectRevert(Fondo.PropuestaYaEjecutada.selector);
        fondo.ejecutar(id);
    }

    function test_pagoAUnNoMiembroRevierteAlEjecutar() public {
        uint256 id = _proponer(miembros[0], Fondo.Accion.Pagar, ajeno, 1e18);
        _aprobar(id, 1, 3);
        vm.expectRevert(Fondo.DestinoNoMiembro.selector);
        fondo.ejecutar(id);
    }

    function test_propuestaInexistente() public {
        vm.expectRevert(Fondo.PropuestaInexistente.selector);
        fondo.ejecutar(99);
    }
}
