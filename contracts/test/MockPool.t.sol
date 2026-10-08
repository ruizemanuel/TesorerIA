// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPool} from "./mocks/MockPool.sol";

contract MockPoolTest is Test {
    MockERC20 wars;
    MockERC20 usdt;
    MockPool pool;

    function setUp() public {
        wars = new MockERC20("wARS", "wARS", 18);
        usdt = new MockERC20("USDT", "USDT", 6);
        // En el pool real, token0 = wARS y el tick es -350142 (8/10/2026): 1 USDT ≈ 1605,88 wARS.
        int24 tick = address(wars) < address(usdt) ? int24(-350142) : int24(350142);
        pool = new MockPool(address(wars), address(usdt), tick);
        wars.mint(address(pool), 1_000_000_000e18);
    }

    function test_cotizaUnUsdtEnAlrededorDe1606Wars() public view {
        uint256 q = OracleLibrary.getQuoteAtTick(pool.tick(), 1e6, address(usdt), address(wars));
        assertApproxEqRel(q, 1605.88e18, 0.001e18);
    }

    function test_observeDevuelveElTickComoPromedio() public view {
        uint32[] memory s = new uint32[](2);
        s[0] = 1800;
        (int56[] memory c,) = pool.observe(s);
        assertEq((c[1] - c[0]) / 1800, pool.tick());
    }

    function test_swapEntregaSegunElTickYCobraPorCallback() public {
        usdt.mint(address(this), 10e6);
        bool zeroForOne = address(usdt) == pool.token0();
        pool.swap(address(this), zeroForOne, int256(uint256(10e6)), 0, "");
        assertApproxEqRel(wars.balanceOf(address(this)), 16_058.8e18, 0.001e18);
        assertEq(usdt.balanceOf(address(pool)), 10e6);
    }

    function test_swapConCalidadBajaEntregaMenos() public {
        usdt.mint(address(this), 10e6);
        pool.setCalidad(9_700);
        bool zeroForOne = address(usdt) == pool.token0();
        pool.swap(address(this), zeroForOne, int256(uint256(10e6)), 0, "");
        assertApproxEqRel(wars.balanceOf(address(this)), 16_058.8e18 * 97 / 100, 0.001e18);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        uint256 aPagar = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        IERC20(address(usdt)).transfer(msg.sender, aPagar);
    }
}
