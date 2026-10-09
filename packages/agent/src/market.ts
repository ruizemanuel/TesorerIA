import { type Address, type PublicClient, erc20Abi, parseAbi } from "viem";
import { fundAbi } from "./abi";
import { POOL, POOL_FEE, UNISWAP_V3_QUOTER, USD_ARS_FEED, USDT, USDT_USD_FEED, WARS } from "./chain";

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/** A Chainlink answer: `answer / 10^decimals`, as of `updatedAt` (Unix seconds). */
export type Feed = { answer: bigint; decimals: number; updatedAt: bigint };

/** The off-pool price reference for conversions: pesos per dollar (Base) and dollars per USDT (Celo). */
export type References = { usdArs: Feed; usdtUsd: Feed };

export type ContractReader = Pick<PublicClient, "readContract">;

async function readFeed(client: ContractReader, address: Address): Promise<Feed> {
  const [decimals, [, answer, , updatedAt]] = await Promise.all([
    client.readContract({ address, abi: feedAbi, functionName: "decimals" }),
    client.readContract({ address, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  return { answer, decimals, updatedAt };
}

/** Reads USD / ARS from Chainlink on Base and USDT / USD from Chainlink on Celo. */
export async function readReferences({ base, celo }: { base: ContractReader; celo: ContractReader }): Promise<References> {
  const [usdArs, usdtUsd] = await Promise.all([readFeed(base, USD_ARS_FEED), readFeed(celo, USDT_USD_FEED)]);
  return { usdArs, usdtUsd };
}

/** What converting `usdtAmount` of a fund's USDT would give, three ways, all in wARS. */
export type ConversionQuote = {
  usdtAmount: bigint;
  /** What the pool pays now, from Uniswap's QuoterV2. */
  quotedWars: bigint;
  /** The fund's own 30-minute TWAP quote: `convert` reverts if `minWarsOut` is under 98% of it. */
  twapWars: bigint;
  /** The pool's wARS balance: its depth on the side a conversion takes from. */
  poolWars: bigint;
};

export async function quoteConversion(
  celo: Pick<PublicClient, "readContract" | "simulateContract">,
  fund: Address,
  usdtAmount: bigint,
): Promise<ConversionQuote> {
  const [quote, twapWars, poolWars] = await Promise.all([
    celo.simulateContract({
      address: UNISWAP_V3_QUOTER,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: USDT, tokenOut: WARS, amountIn: usdtAmount, fee: POOL_FEE, sqrtPriceLimitX96: 0n }],
    }),
    celo.readContract({ address: fund, abi: fundAbi, functionName: "quoteUsdtInWars", args: [usdtAmount] }),
    celo.readContract({ address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [POOL] }),
  ]);
  return { usdtAmount, quotedWars: quote.result[0], twapWars, poolWars };
}
