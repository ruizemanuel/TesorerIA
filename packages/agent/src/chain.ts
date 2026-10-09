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

/** The agent's own wallet: it deployed FUND_FACTORY and signs every agent transaction. */
export const AGENT_ADDRESS: Address = "0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671";
/** TesorerIA's FundFactory, deployed by the agent's wallet on 2026-10-09. */
export const FUND_FACTORY: Address = "0xdF3B0d9edCA58Aac7c9Db4F2931f3559daf82020";
/** The block FUND_FACTORY was deployed in: no fund has older events. */
export const FUND_FACTORY_BLOCK = 79_659_548n;
/** Uniswap v3 QuoterV2 on Celo (official deployment; its `factory()` is UNISWAP_V3_FACTORY). */
export const UNISWAP_V3_QUOTER: Address = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8";
/** Chainlink USD / ARS on Base: pesos per dollar, 8 decimals, updated about once a day. */
export const USD_ARS_FEED: Address = "0x9eb8a54d0590798880C665C7A6d51B95f4078Ad7";
/** Chainlink USDT / USD on Celo: dollars per USDT, 8 decimals. */
export const USDT_USD_FEED: Address = "0x5e37AF40A7A344ec9b03CCD34a250F3dA9a20B02";
/** ERC-8004 Identity Registry on Celo mainnet. */
export const IDENTITY_REGISTRY: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
/** Blockscout's Etherscan-style API for Celo: a fund's whole log history without the RPC's 5,000-block limit. */
export const BLOCKSCOUT_API = "https://celo.blockscout.com/api";
