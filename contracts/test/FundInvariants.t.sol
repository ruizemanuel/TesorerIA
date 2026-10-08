// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {BaseFondoTest} from "./Base.t.sol";
import {Fondo} from "../src/Fund.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// Hace, en orden al azar, aportes en wARS y acciones de gobierno completas (proponer, votar hasta N y ejecutar).
/// Cada llamada es una acción coherente: si no sería válida en el estado actual, la saltea en vez de revertir.
contract HandlerFondo is CommonBase, StdCheats, StdUtils {
    Fondo public immutable fondo;
    MockERC20 public immutable wars;
    /// Todas las direcciones que el handler puede tocar: los miembros iniciales y los candidatos a entrar.
    address[] internal _actores;

    constructor(Fondo fondo_, MockERC20 wars_, address[] memory actores_) {
        fondo = fondo_;
        wars = wars_;
        _actores = actores_;
    }

    function actores() external view returns (address[] memory) {
        return _actores;
    }

    function aportar(uint256 semilla, uint256 monto) external {
        uint256 saldo = fondo.saldoEnWars();
        uint256 tope = fondo.topeSaldoTotal();
        if (saldo >= tope) return;
        monto = bound(monto, 1, tope - saldo);
        address[] memory lista = fondo.miembros();
        address m = lista[semilla % lista.length];
        wars.mint(m, monto);
        vm.startPrank(m);
        wars.approve(address(fondo), monto);
        fondo.aportarWars(monto);
        vm.stopPrank();
    }

    function agregarMiembro(uint256 semilla) external {
        if (fondo.miembros().length >= fondo.MAX_MIEMBROS()) return;
        (address x, bool hay) = _noMiembro(semilla);
        if (!hay) return;
        _aprobarYEjecutar(Fondo.Accion.AgregarMiembro, x, address(0), 0, semilla);
    }

    function sacarMiembro(uint256 semilla) external {
        address[] memory lista = fondo.miembros();
        if (lista.length - 1 < fondo.votosNecesarios()) return;
        _aprobarYEjecutar(Fondo.Accion.SacarMiembro, lista[semilla % lista.length], address(0), 0, semilla);
    }

    function cambiarMiembro(uint256 semillaViejo, uint256 semillaNuevo) external {
        (address nuevo, bool hay) = _noMiembro(semillaNuevo);
        if (!hay) return;
        address[] memory lista = fondo.miembros();
        _aprobarYEjecutar(Fondo.Accion.CambiarMiembro, lista[semillaViejo % lista.length], nuevo, 0, semillaViejo);
    }

    function cambiarVotos(uint256 votos, uint256 semilla) external {
        votos = bound(votos, fondo.MIN_VOTOS(), fondo.miembros().length);
        _aprobarYEjecutar(Fondo.Accion.CambiarVotos, address(0), address(0), votos, semilla);
    }

    /// Propone un miembro al azar (y con eso vota), votan los siguientes hasta llegar a N y ejecuta cualquiera.
    function _aprobarYEjecutar(Fondo.Accion accion, address a, address b, uint256 monto, uint256 semilla) internal {
        address[] memory lista = fondo.miembros();
        uint256 n = lista.length;
        uint256 primero = uint256(keccak256(abi.encode(semilla, accion))) % n;
        vm.prank(lista[primero]);
        uint256 id = fondo.proponer(accion, a, b, monto, "invariante");
        for (uint256 k = 1; k < n && fondo.votosDe(id) < fondo.votosNecesarios(); ++k) {
            vm.prank(lista[(primero + k) % n]);
            fondo.votar(id);
        }
        fondo.ejecutar(id);
    }

    /// El primer actor que no es miembro, empezando por uno al azar.
    function _noMiembro(uint256 semilla) internal view returns (address, bool) {
        uint256 n = _actores.length;
        uint256 desde = semilla % n;
        for (uint256 k; k < n; ++k) {
            address x = _actores[(desde + k) % n];
            if (!fondo.esMiembro(x)) return (x, true);
        }
        return (address(0), false);
    }
}

/// Con cambios de miembros, de N y aportes en cualquier orden, la lista de miembros (la que cuenta los votos y
/// reparte el cierre) coincide con `esMiembro`, y lo aportado cuadra con `totalAportado`.
contract FondoInvariantesTest is BaseFondoTest {
    HandlerFondo internal handler;

    function setUp() public override {
        super.setUp();
        address[] memory actores = new address[](12);
        for (uint256 i; i < 5; ++i) actores[i] = miembros[i];
        for (uint256 i = 5; i < 12; ++i) actores[i] = makeAddr(string.concat("candidato", vm.toString(i)));
        handler = new HandlerFondo(fondo, wars, actores);

        bytes4[] memory acciones = new bytes4[](5);
        acciones[0] = HandlerFondo.aportar.selector;
        acciones[1] = HandlerFondo.agregarMiembro.selector;
        acciones[2] = HandlerFondo.sacarMiembro.selector;
        acciones[3] = HandlerFondo.cambiarMiembro.selector;
        acciones[4] = HandlerFondo.cambiarVotos.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: acciones}));
    }

    function _esta(address[] memory lista, address x) internal pure returns (bool) {
        for (uint256 i; i < lista.length; ++i) {
            if (lista[i] == x) return true;
        }
        return false;
    }

    function invariant_votosYMiembrosEnRango() public view {
        uint256 n = fondo.miembros().length;
        uint256 votos = fondo.votosNecesarios();
        assertGe(votos, 2);
        assertLe(votos, n);
        assertLe(n, 10);
    }

    function invariant_esMiembroSiYSoloSiEstaEnLaLista() public view {
        address[] memory lista = fondo.miembros();
        address[] memory actores = handler.actores();
        for (uint256 i; i < actores.length; ++i) {
            assertEq(fondo.esMiembro(actores[i]), _esta(lista, actores[i]));
        }
        for (uint256 i; i < lista.length; ++i) {
            assertTrue(fondo.esMiembro(lista[i]));
        }
    }

    function invariant_sinRepetidosEnLaLista() public view {
        address[] memory lista = fondo.miembros();
        for (uint256 i; i < lista.length; ++i) {
            for (uint256 j = i + 1; j < lista.length; ++j) {
                assertNotEq(lista[i], lista[j]);
            }
        }
    }

    function invariant_loAportadoPorLosMiembrosSumaElTotal() public view {
        address[] memory lista = fondo.miembros();
        uint256 suma;
        for (uint256 i; i < lista.length; ++i) {
            suma += fondo.aportado(lista[i]);
        }
        assertEq(suma, fondo.totalAportado());
    }

    function invariant_quienNoEsMiembroNoTieneAportado() public view {
        address[] memory actores = handler.actores();
        for (uint256 i; i < actores.length; ++i) {
            if (!fondo.esMiembro(actores[i])) assertEq(fondo.aportado(actores[i]), 0);
        }
    }
}
