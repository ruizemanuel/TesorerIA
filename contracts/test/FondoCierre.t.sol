// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fondo.sol";

contract FondoCierreTest is BaseFondoTest {
    function _cerrar() internal {
        uint256 id = _proponer(miembros[0], Fondo.Accion.Cerrar, address(0), address(0), 0);
        _aprobar(id, 1, 3);
        fondo.ejecutar(id);
    }

    function test_cierreRepartePorAporte() public {
        _aportarWars(miembros[0], 30_000e18);
        _aportarWars(miembros[1], 10_000e18);
        _cerrar();
        assertTrue(fondo.cerrado());
        assertEq(wars.balanceOf(miembros[0]), 30_000e18);
        assertEq(wars.balanceOf(miembros[1]), 10_000e18);
        assertEq(wars.balanceOf(miembros[2]), 0);
    }

    function test_cierreConUsdtSinConvertir() public {
        _aportarWars(miembros[0], 16_058.8e18);
        _aportarUsdt(miembros[1], 10e6);
        _cerrar();
        assertApproxEqAbs(usdt.balanceOf(miembros[1]), 5e6, 0.02e6);
        assertApproxEqAbs(usdt.balanceOf(miembros[0]), 5e6, 0.02e6);
    }

    function test_sinAportesRepartePorIgual() public {
        wars.mint(address(fondo), 5_000e18);
        _cerrar();
        for (uint256 i; i < 5; ++i) assertEq(wars.balanceOf(miembros[i]), 1_000e18);
    }

    // Review Focus 1: lo que llega directo al contrato no se le acredita a nadie y se reparte por aporte.
    function test_transferenciaDirectaSeRepartePorAporte() public {
        _aportarWars(miembros[0], 30_000e18);
        _aportarWars(miembros[1], 10_000e18);
        wars.mint(address(fondo), 4_000e18); // por ejemplo, un retiro mandado al contrato por error
        assertEq(fondo.totalAportado(), 40_000e18);
        _cerrar();
        assertEq(wars.balanceOf(miembros[0]), 33_000e18);
        assertEq(wars.balanceOf(miembros[1]), 11_000e18);
    }

    function test_despuesDeCerrarTodoRevierte() public {
        _aportarWars(miembros[0], 1_000e18);
        _cerrar();
        vm.prank(miembros[0]);
        vm.expectRevert(Fondo.FondoCerrado.selector);
        fondo.aportarWars(1);
        vm.prank(agente);
        vm.expectRevert(Fondo.FondoCerrado.selector);
        fondo.reintegrarGastoAcordado(miembros[0], 1, bytes32(0));
        vm.prank(miembros[0]);
        vm.expectRevert(Fondo.FondoCerrado.selector);
        fondo.proponer(Fondo.Accion.Pagar, miembros[1], address(0), 1, "x");
    }

    function testFuzz_cierreConservaElSaldo(uint96 a, uint96 b, uint96 c) public {
        uint256 x = bound(a, 1, 100_000e18);
        uint256 y = bound(b, 1, 100_000e18);
        uint256 z = bound(c, 1, 100_000e18);
        _aportarWars(miembros[0], x);
        _aportarWars(miembros[1], y);
        _aportarWars(miembros[2], z);
        _cerrar();
        uint256 repartido = wars.balanceOf(miembros[0]) + wars.balanceOf(miembros[1]) + wars.balanceOf(miembros[2]);
        assertLe(repartido, x + y + z);
        assertLe(wars.balanceOf(address(fondo)), 5); // polvo de redondeo: menos de 1 wei por miembro
    }

    // Review fix: el saldo llega también por transferencia directa, así que el reparto redondea de verdad.
    function testFuzz_cierreRepartePorAporteConRedondeo(uint96 a, uint96 b, uint96 c, uint96 extraW, uint64 extraU)
        public
    {
        uint256[3] memory ap;
        ap[0] = bound(a, 1, 100_000e18);
        ap[1] = bound(b, 1, 100_000e18);
        ap[2] = bound(c, 1, 100_000e18);
        for (uint256 i; i < 3; ++i) _aportarWars(miembros[i], ap[i]);
        wars.mint(address(fondo), bound(extraW, 0, 100_000e18));
        usdt.mint(address(fondo), bound(extraU, 0, 1_000e6));

        uint256 bw = wars.balanceOf(address(fondo));
        uint256 bu = usdt.balanceOf(address(fondo));
        uint256 t = fondo.totalAportado();
        for (uint256 i; i < 3; ++i) ap[i] = fondo.aportado(miembros[i]);

        _cerrar();

        uint256 sw;
        uint256 su;
        for (uint256 i; i < 3; ++i) {
            assertEq(wars.balanceOf(miembros[i]), bw * ap[i] / t);
            assertEq(usdt.balanceOf(miembros[i]), bu * ap[i] / t);
            sw += wars.balanceOf(miembros[i]);
            su += usdt.balanceOf(miembros[i]);
        }
        for (uint256 i = 3; i < 5; ++i) {
            assertEq(wars.balanceOf(miembros[i]), 0);
            assertEq(usdt.balanceOf(miembros[i]), 0);
        }
        assertEq(sw + wars.balanceOf(address(fondo)), bw);
        assertEq(su + usdt.balanceOf(address(fondo)), bu);
        assertLt(wars.balanceOf(address(fondo)), 3);
        assertLt(usdt.balanceOf(address(fondo)), 3);
    }

    // Review fix: sin aportes, el saldo se reparte por igual y el resto de la división queda en el contrato.
    function testFuzz_cierreSinAportesRepartePorIgual(uint96 w, uint64 u) public {
        uint256 bw = bound(w, 1, 1_000_000e18);
        uint256 bu = bound(u, 1, 1_000_000e6);
        wars.mint(address(fondo), bw);
        usdt.mint(address(fondo), bu);

        _cerrar();

        for (uint256 i; i < 5; ++i) {
            assertEq(wars.balanceOf(miembros[i]), bw / 5);
            assertEq(usdt.balanceOf(miembros[i]), bu / 5);
        }
        assertEq(wars.balanceOf(address(fondo)), bw % 5);
        assertEq(usdt.balanceOf(address(fondo)), bu % 5);
    }
}
