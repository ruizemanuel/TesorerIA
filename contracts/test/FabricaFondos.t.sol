// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fondo.sol";
import {FabricaFondos} from "../src/FabricaFondos.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

contract FabricaFondosTest is BaseFondoTest {
    FabricaFondos fabrica;

    function setUp() public override {
        super.setUp();
        fabrica = new FabricaFondos(IERC20(address(wars)), IERC20(address(usdt)), IUniswapV3Pool(address(pool)));
    }

    function test_creaUnFondoConLosParametros() public {
        vm.prank(miembros[0]);
        address creado = fabrica.crearFondo(_params());
        assertEq(fabrica.cantidadFondos(), 1);
        assertEq(fabrica.fondos(0), creado);
        Fondo f = Fondo(creado);
        assertEq(f.nombre(), "Futbol de los jueves");
        assertEq(address(f.wars()), address(wars));
        assertEq(address(f.pool()), address(pool));
        assertEq(f.miembros().length, 5);
    }

    function test_emiteFondoCreado() public {
        vm.expectEmit(false, true, false, true, address(fabrica));
        emit FabricaFondos.FondoCreado(address(0), miembros[0], "Futbol de los jueves");
        vm.prank(miembros[0]);
        fabrica.crearFondo(_params());
    }

    function test_parametrosInvalidosRevierten() public {
        Fondo.Parametros memory p = _params();
        p.votosNecesarios = 9;
        vm.expectRevert(Fondo.ParametrosInvalidos.selector);
        fabrica.crearFondo(p);
    }

    function test_poolDeOtrosTokensRevierte() public {
        MockERC20 otro = new MockERC20("OTRO", "OTRO", 18);
        MockPool malo = new MockPool(address(otro), address(usdt), 0);
        vm.expectRevert(FabricaFondos.PoolInvalido.selector);
        new FabricaFondos(IERC20(address(wars)), IERC20(address(usdt)), IUniswapV3Pool(address(malo)));
    }
}
