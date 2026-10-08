// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3SwapCallback} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

/// @title Fondo de TesorerIA
/// @notice Fondo común de un grupo en wARS. Nadie del grupo tiene la plata: el agente solo puede convertir USDT
///         a wARS y reintegrar el gasto acordado hasta un tope semanal, siempre a miembros. Todo lo demás se vota.
contract Fondo is ReentrancyGuardTransient, IUniswapV3SwapCallback {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- Constantes
    uint256 public constant MIN_MIEMBROS = 3;
    uint256 public constant MAX_MIEMBROS = 10;
    uint256 public constant MIN_VOTOS = 2;
    uint32 public constant VENTANA_TWAP = 30 minutes;
    uint256 public constant DESVIO_MAX_BPS = 200;
    uint256 public constant BPS = 10_000;
    uint256 public constant SEMANA = 7 days;
    uint256 public constant DURACION_PROPUESTA = 7 days;

    // ---------------------------------------------------------------- Tipos
    struct Parametros {
        string nombre;
        address[] miembros;
        uint8 votosNecesarios;
        address agente;
        string gastoAcordado;
        uint256 topeSemanal;
        uint256 topeSaldoTotal;
    }

    enum Accion {
        Pagar,
        AgregarMiembro,
        SacarMiembro,
        CambiarMiembro,
        CambiarTope,
        CambiarVotos,
        CambiarAgente,
        Cerrar
    }

    struct Propuesta {
        Accion accion;
        address a;
        address b;
        uint256 monto;
        uint64 vence;
        bool ejecutada;
        address proponente;
        string nota;
    }

    // ---------------------------------------------------------------- Errores
    error ParametrosInvalidos();
    error NoEsMiembro();
    error SoloAgente();
    error SoloMiembroOAgente();
    error FondoCerrado();
    error MontoCero();
    error TopeSaldoSuperado();
    error TopeSemanalSuperado();
    error SaldoInsuficiente();
    error DestinoNoMiembro();
    error MinimoMuyBajo();
    error RecibidoInsuficiente();
    error SoloPool();
    error PropuestaInexistente();
    error PropuestaVencida();
    error PropuestaYaEjecutada();
    error YaVoto();
    error VotosInsuficientes();

    // ---------------------------------------------------------------- Eventos
    event Aporte(address indexed miembro, address indexed token, uint256 monto, uint256 acreditadoWars);
    event Conversion(uint256 usdtEntregado, uint256 warsRecibido);
    event Reintegro(address indexed miembro, uint256 monto, bytes32 ref, uint256 semana);
    event PropuestaCreada(
        uint256 indexed id, Accion accion, address a, address b, uint256 monto, address indexed proponente, string nota
    );
    event Voto(uint256 indexed id, address indexed miembro);
    event PropuestaEjecutada(uint256 indexed id);
    event Pago(address indexed miembro, uint256 monto);
    event MiembroAgregado(address indexed miembro);
    event MiembroSacado(address indexed miembro, uint256 warsDevuelto, uint256 usdtDevuelto);
    event MiembroCambiado(address indexed viejo, address indexed nuevo);
    event TopeSemanalCambiado(uint256 tope);
    event VotosNecesariosCambiados(uint8 votos);
    event AgenteCambiado(address indexed agente);
    event Cierre(uint256 warsRepartido, uint256 usdtRepartido);

    // ---------------------------------------------------------------- Estado
    IERC20 public immutable wars;
    IERC20 public immutable usdt;
    IUniswapV3Pool public immutable pool;
    uint256 public immutable inicio;
    uint256 public immutable topeSaldoTotal;

    string public nombre;
    string public gastoAcordado;
    uint256 public topeSemanal;
    uint8 public votosNecesarios;
    address public agente;
    bool public cerrado;

    address[] private _miembros;
    mapping(address => bool) public esMiembro;
    mapping(address => uint256) public aportado;
    uint256 public totalAportado;
    mapping(uint256 => uint256) public gastadoEnSemana;

    Propuesta[] private _propuestas;
    mapping(uint256 => mapping(address => bool)) public votoDe;

    bool private _swapEnCurso;

    // ---------------------------------------------------------------- Modificadores
    modifier soloMiembro() {
        if (!esMiembro[msg.sender]) revert NoEsMiembro();
        _;
    }

    modifier soloAgente() {
        if (msg.sender != agente) revert SoloAgente();
        _;
    }

    modifier abierto() {
        if (cerrado) revert FondoCerrado();
        _;
    }

    // ---------------------------------------------------------------- Creación
    constructor(IERC20 wars_, IERC20 usdt_, IUniswapV3Pool pool_, Parametros memory p) {
        address t0 = pool_.token0();
        address t1 = pool_.token1();
        bool tokensOk = (t0 == address(wars_) && t1 == address(usdt_)) || (t0 == address(usdt_) && t1 == address(wars_));
        uint256 n = p.miembros.length;
        if (
            !tokensOk || n < MIN_MIEMBROS || n > MAX_MIEMBROS || p.votosNecesarios < MIN_VOTOS
                || p.votosNecesarios > n || p.topeSaldoTotal == 0
        ) revert ParametrosInvalidos();
        for (uint256 i; i < n; ++i) {
            address m = p.miembros[i];
            if (m == address(0) || m == p.agente || esMiembro[m]) revert ParametrosInvalidos();
            esMiembro[m] = true;
            _miembros.push(m);
        }
        wars = wars_;
        usdt = usdt_;
        pool = pool_;
        inicio = block.timestamp;
        topeSaldoTotal = p.topeSaldoTotal;
        nombre = p.nombre;
        gastoAcordado = p.gastoAcordado;
        topeSemanal = p.topeSemanal;
        votosNecesarios = p.votosNecesarios;
        agente = p.agente;
    }

    // ---------------------------------------------------------------- Vistas
    function miembros() external view returns (address[] memory) {
        return _miembros;
    }

    function semanaActual() public view returns (uint256) {
        return (block.timestamp - inicio) / SEMANA;
    }

    /// @notice Cuántos wARS valen `montoUsdt` según el TWAP de 30 minutos del pool.
    function cotizarUsdtEnWars(uint256 montoUsdt) public view returns (uint256) {
        if (montoUsdt == 0) return 0;
        if (montoUsdt > type(uint128).max) revert ParametrosInvalidos();
        return OracleLibrary.getQuoteAtTick(_tickPromedio(), uint128(montoUsdt), address(usdt), address(wars));
    }

    /// @notice Saldo total del fondo expresado en wARS (el USDT, al TWAP).
    function saldoEnWars() public view returns (uint256) {
        return wars.balanceOf(address(this)) + cotizarUsdtEnWars(usdt.balanceOf(address(this)));
    }

    function _tickPromedio() internal view returns (int24 t) {
        uint32[] memory hace = new uint32[](2);
        hace[0] = VENTANA_TWAP;
        (int56[] memory acumulados,) = pool.observe(hace);
        int56 delta = acumulados[1] - acumulados[0];
        t = int24(delta / int56(uint56(VENTANA_TWAP)));
        if (delta < 0 && (delta % int56(uint56(VENTANA_TWAP)) != 0)) t--;
    }

    // ---------------------------------------------------------------- Aportes
    function aportarWars(uint256 monto) external soloMiembro abierto nonReentrant {
        uint256 recibido = _recibir(wars, monto);
        _acreditar(msg.sender, address(wars), recibido, recibido);
    }

    function aportarUsdt(uint256 monto) external soloMiembro abierto nonReentrant {
        uint256 recibido = _recibir(usdt, monto);
        _acreditar(msg.sender, address(usdt), recibido, cotizarUsdtEnWars(recibido));
    }

    /// @dev Mide lo recibido por diferencia de saldo, dentro de la llamada (regla CIP-64 del spec).
    function _recibir(IERC20 token, uint256 monto) internal returns (uint256) {
        if (monto == 0) revert MontoCero();
        uint256 antes = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), monto);
        return token.balanceOf(address(this)) - antes;
    }

    function _acreditar(address miembro, address token, uint256 recibido, uint256 enWars) internal {
        if (saldoEnWars() > topeSaldoTotal) revert TopeSaldoSuperado();
        aportado[miembro] += enWars;
        totalAportado += enWars;
        emit Aporte(miembro, token, recibido, enWars);
    }

    // ---------------------------------------------------------------- Swap (lo completa la Tarea 5)
    function uniswapV3SwapCallback(int256, int256, bytes calldata) external pure override {
        revert SoloPool();
    }
}
