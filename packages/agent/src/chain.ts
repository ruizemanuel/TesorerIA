import type { Address } from "viem";

/** Celo mainnet (chain 42220) addresses the agent works with. */
export const CELO_CHAIN_ID = 42220;
export const WARS: Address = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
export const USDT: Address = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
/** Fee-currency adapter for USDT, registered in Celo's FeeCurrencyDirectory: the agent pays its gas through it. */
export const USDT_FEE_ADAPTER: Address = "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72";
/** Uniswap v3 wARS/USDT pool, 0.01% fee tier (token0 = wARS). */
export const POOL: Address = "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391";
export const POOL_FEE = 100;
/** Official UniswapV3Factory on Celo: the pool must be the one it returns. */
export const UNISWAP_V3_FACTORY: Address = "0xAfE208a311B21f13EF87E33A90049fC17A7acDEc";
/** The fund's TWAP window, in seconds (`Fund.TWAP_WINDOW`). */
export const TWAP_WINDOW = 1800;
