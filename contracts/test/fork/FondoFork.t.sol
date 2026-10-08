// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {Fondo} from "../../src/Fondo.sol";
import {FabricaFondos} from "../../src/FabricaFondos.sol";

/// Corre contra un fork local de Celo mainnet (lo crea `setUp`): `forge test --match-path "test/fork/*" -vv`.
contract FondoForkTest is Test {
    IERC20 constant WARS = IERC20(0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D);
    IERC20 constant USDT = IERC20(0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e);
    IUniswapV3Pool constant POOL = IUniswapV3Pool(0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391);

    Fondo fondo;
    address agente = makeAddr("agente");
    address[] miembros;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("celo"));
        for (uint256 i; i < 3; ++i) miembros.push(makeAddr(string.concat("miembro", vm.toString(i))));
        FabricaFondos fabrica = new FabricaFondos(WARS, USDT, POOL);
        Fondo.Parametros memory p;
        p.nombre = "Fork";
        p.miembros = miembros;
        p.votosNecesarios = 2;
        p.agente = agente;
        p.gastoAcordado = "Cancha";
        p.topeSemanal = 60_000e18;
        p.topeSaldoTotal = 2_000_000e18;
        fondo = Fondo(fabrica.crearFondo(p));
    }

    /// El pool tiene USDT y wARS de sobra: se los "presta" a los miembros en el fork.
    function _dar(IERC20 token, address a, uint256 monto) internal {
        vm.prank(address(POOL));
        token.transfer(a, monto);
    }

    function test_twapDaUnPrecioRazonable() public view {
        uint256 q = fondo.cotizarUsdtEnWars(1e6);
        assertGt(q, 1_000e18);
        assertLt(q, 3_000e18);
    }

    function test_aportarUsdtYConvertirContraElPoolReal() public {
        _dar(USDT, miembros[0], 300e6);
        vm.startPrank(miembros[0]);
        USDT.approve(address(fondo), 300e6);
        fondo.aportarUsdt(300e6);
        vm.stopPrank();
        uint256 acreditado = fondo.aportado(miembros[0]);
        assertApproxEqRel(acreditado, fondo.cotizarUsdtEnWars(300e6), 0.0001e18);

        uint256 esperado = fondo.cotizarUsdtEnWars(300e6);
        vm.prank(agente);
        uint256 recibido = fondo.convertir(300e6, esperado * 99 / 100);
        assertApproxEqRel(recibido, esperado, 0.01e18);
        assertEq(USDT.balanceOf(address(fondo)), 0);
        assertEq(WARS.balanceOf(address(fondo)), recibido);
    }

    function test_conversionChicaDe5Usdt() public {
        _dar(USDT, miembros[1], 5e6);
        vm.startPrank(miembros[1]);
        USDT.approve(address(fondo), 5e6);
        fondo.aportarUsdt(5e6);
        vm.stopPrank();
        uint256 esperado = fondo.cotizarUsdtEnWars(5e6);
        vm.prank(agente);
        uint256 recibido = fondo.convertir(5e6, esperado * 99 / 100);
        assertApproxEqRel(recibido, esperado, 0.01e18);
    }

    function test_aportarWarsYReintegrar() public {
        _dar(WARS, miembros[2], 50_000e18);
        vm.startPrank(miembros[2]);
        WARS.approve(address(fondo), 50_000e18);
        fondo.aportarWars(50_000e18);
        vm.stopPrank();
        vm.prank(agente);
        fondo.reintegrarGastoAcordado(miembros[0], 45_000e18, keccak256("cancha"));
        assertEq(WARS.balanceOf(miembros[0]), 45_000e18);
    }
}
