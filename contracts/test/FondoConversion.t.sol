// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fondo.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {Atacante, MockPoolHostil} from "./mocks/MockPoolHostil.sol";

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

    // Review final: el margen es exactamente 2 %. El mínimo justo en el 98 % de la cotización pasa (y el pool
    // que entrega justo eso también); un wei menos, no.
    function test_minimoJustoEnEl98PorCientoSeAcepta() public {
        uint256 piso = fondo.cotizarUsdtEnWars(10e6) * 9_800 / 10_000;
        pool.setCalidad(9_800); // entrega 2 % menos: justo el piso
        vm.prank(agente);
        uint256 recibido = fondo.convertir(10e6, piso);
        assertEq(recibido, piso);
        assertEq(usdt.balanceOf(address(fondo)), 40e6);
    }

    function test_minimoUnWeiDebajoDel98PorCientoRevierte() public {
        uint256 piso = fondo.cotizarUsdtEnWars(10e6) * 9_800 / 10_000;
        vm.prank(agente);
        vm.expectRevert(Fondo.MinimoMuyBajo.selector);
        fondo.convertir(10e6, piso - 1);
    }

    function testFuzz_elMargenEsExactamenteDel2PorCiento(uint256 monto) public {
        monto = bound(monto, 1, 50e6);
        uint256 piso = fondo.cotizarUsdtEnWars(monto) * 9_800 / 10_000;
        pool.setCalidad(9_800);
        vm.startPrank(agente);
        vm.expectRevert(Fondo.MinimoMuyBajo.selector);
        fondo.convertir(monto, piso - 1);
        assertEq(fondo.convertir(monto, piso), piso);
        vm.stopPrank();
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

    /// Fondo nuevo sobre un pool que, en medio del swap, deja que un tercero llame la callback del fondo.
    function _fondoConPoolHostil() internal returns (Atacante atacante) {
        MockPoolHostil hostil = new MockPoolHostil(address(wars), address(usdt), -350142);
        wars.mint(address(hostil), 1_000_000_000e18);
        pool = MockPool(address(hostil));
        fondo = _nuevoFondo(_params());
        _aportarUsdt(miembros[0], 50e6);
        atacante = hostil.atacante();
    }

    // Review final: mientras dura la conversión (`_swapEnCurso`), solo el pool puede cobrar por la callback.
    function test_otroQueNoEsElPoolNoPuedeCobrarDuranteLaConversion() public {
        _fondoConPoolHostil();
        uint256 esperado = fondo.cotizarUsdtEnWars(10e6);
        vm.prank(agente);
        vm.expectRevert(Fondo.SoloPool.selector);
        fondo.convertir(10e6, esperado * 99 / 100);
    }

    function test_unTerceroDuranteLaConversionNoSeLlevaElUsdtDelFondo() public {
        Atacante atacante = _fondoConPoolHostil();
        atacante.setTragarError(true);
        uint256 esperado = fondo.cotizarUsdtEnWars(10e6);
        vm.prank(agente);
        fondo.convertir(10e6, esperado * 99 / 100);
        assertEq(atacante.ultimoError(), abi.encodeWithSelector(Fondo.SoloPool.selector));
        assertEq(usdt.balanceOf(address(fondo)), 40e6); // solo pagó los 10 USDT del swap
        assertEq(usdt.balanceOf(address(pool)), 10e6);
    }
}
