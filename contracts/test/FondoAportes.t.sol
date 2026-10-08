// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fondo.sol";

contract FondoAportesTest is BaseFondoTest {
    function test_aportarWarsAcreditaLoRecibido() public {
        wars.mint(miembros[0], 10_000e18);
        vm.startPrank(miembros[0]);
        wars.approve(address(fondo), 10_000e18);
        vm.expectEmit(true, true, false, true, address(fondo));
        emit Fondo.Aporte(miembros[0], address(wars), 10_000e18, 10_000e18);
        fondo.aportarWars(10_000e18);
        vm.stopPrank();
        assertEq(fondo.aportado(miembros[0]), 10_000e18);
        assertEq(fondo.totalAportado(), 10_000e18);
        assertEq(wars.balanceOf(address(fondo)), 10_000e18);
    }

    function test_aportarUsdtAcreditaAlTwap() public {
        _aportarUsdt(miembros[1], 10e6);
        assertApproxEqRel(fondo.aportado(miembros[1]), 16_058.8e18, 0.001e18);
        assertEq(usdt.balanceOf(address(fondo)), 10e6);
        assertApproxEqRel(fondo.saldoEnWars(), 16_058.8e18, 0.001e18);
    }

    function test_noMiembroNoPuedeAportar() public {
        wars.mint(ajeno, 1e18);
        vm.startPrank(ajeno);
        wars.approve(address(fondo), 1e18);
        vm.expectRevert(Fondo.NoEsMiembro.selector);
        fondo.aportarWars(1e18);
        vm.stopPrank();
    }

    function test_aporteCeroRevierte() public {
        vm.prank(miembros[0]);
        vm.expectRevert(Fondo.MontoCero.selector);
        fondo.aportarWars(0);
    }

    function test_aporteQuePasaElTopeTotalRevierte() public {
        _aportarWars(miembros[0], 440_000e18);
        wars.mint(miembros[1], 20_000e18);
        vm.startPrank(miembros[1]);
        wars.approve(address(fondo), 20_000e18);
        vm.expectRevert(Fondo.TopeSaldoSuperado.selector);
        fondo.aportarWars(20_000e18);
        vm.stopPrank();
    }

    function test_elUsdtCuentaParaElTope() public {
        _aportarUsdt(miembros[0], 270e6); // ≈ 433.588 wARS
        usdt.mint(miembros[1], 20e6); // ≈ 32.118 wARS más: pasa los 450.000
        vm.startPrank(miembros[1]);
        usdt.approve(address(fondo), 20e6);
        vm.expectRevert(Fondo.TopeSaldoSuperado.selector);
        fondo.aportarUsdt(20e6);
        vm.stopPrank();
    }

    function testFuzz_nuncaSeSuperaElTope(uint256 a, uint256 b) public {
        a = bound(a, 1, 500_000e18);
        b = bound(b, 1, 500_000e18);
        wars.mint(miembros[0], a);
        vm.startPrank(miembros[0]);
        wars.approve(address(fondo), a);
        if (a > TOPE_TOTAL) vm.expectRevert(Fondo.TopeSaldoSuperado.selector);
        fondo.aportarWars(a);
        vm.stopPrank();
        uint256 yaAdentro = wars.balanceOf(address(fondo));
        wars.mint(miembros[1], b);
        vm.startPrank(miembros[1]);
        wars.approve(address(fondo), b);
        if (yaAdentro + b > TOPE_TOTAL) vm.expectRevert(Fondo.TopeSaldoSuperado.selector);
        fondo.aportarWars(b);
        vm.stopPrank();
        assertLe(fondo.saldoEnWars(), TOPE_TOTAL);
    }
}
