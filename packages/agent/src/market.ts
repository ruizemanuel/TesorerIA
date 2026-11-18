import { type Address, type PublicClient, erc20Abi, parseAbi } from "viem";
import { fundAbi, fundV2Abi } from "./abi";
import { UNISWAP_V3_QUOTER, USDT_USD_FEED } from "./chain";
import { type Currency, currencyOf } from "./currencies";
import type { FundSnapshot } from "./fund";

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/** A Chainlink answer: `answer / 10^decimals`, as of `updatedAt` (Unix seconds). */
export type Feed = { answer: bigint; decimals: number; updatedAt: bigint };

/**
 * The off-pool price reference for a conversion: the currency's own feed, on the chain the table says (units of the
 * currency per dollar, or dollars per unit, as `reference.perUsd` says), and dollars per USDT (Celo).
 */
export type References = { currencyUsd: Feed; dollarUsd: Feed };

export type ContractReader = Pick<PublicClient, "readContract">;

async function readFeed(client: ContractReader, address: Address): Promise<Feed> {
  const [decimals, [, answer, , updatedAt]] = await Promise.all([
    client.readContract({ address, abi: feedAbi, functionName: "decimals" }),
    client.readContract({ address, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  return { answer, decimals, updatedAt };
}

/** Reads the currency's feed from Chainlink on its chain (Base or Celo) and USDT / USD from Chainlink on Celo. */
export async function readReferences(
  { base, celo }: { base: ContractReader; celo: ContractReader },
  currency: Currency,
): Promise<References> {
  const { reference } = currency;
  if (reference === null) throw new Error(`The agent has no price reference for ${currency.symbol}`);
  const [currencyUsd, dollarUsd] = await Promise.all([
    readFeed(reference.chain === "base" ? base : celo, reference.feed),
    readFeed(celo, USDT_USD_FEED),
  ]);
  return { currencyUsd, dollarUsd };
}

/** What converting `dollarAmount` of a fund's dollar would give, three ways, all in the fund's currency. */
export type ConversionQuote = {
  dollarAmount: bigint;
  /** What the pool pays now, from Uniswap's QuoterV2. */
  quotedCurrency: bigint;
  /** The fund's own 30-minute TWAP quote: `convert` reverts if `minCurrencyOut` is under 98% of it. */
  twapCurrency: bigint;
  /** The pool's balance of the currency: its depth on the side a conversion takes from. */
  poolCurrency: bigint;
};

/**
 * The quote for converting `dollarAmount` of the fund's dollar into its currency: the tokens and the pool are the
 * fund's, the pool's fee is the table's, and the TWAP is the fund's own (`quoteUsdtInWars` in version 1, `quoteDollar`
 * in version 2).
 */
export async function quoteConversion(
  celo: Pick<PublicClient, "readContract" | "simulateContract">,
  fund: FundSnapshot,
  dollarAmount: bigint,
): Promise<ConversionQuote> {
  const { dollar, pool } = fund;
  if (dollar === null || pool === null) throw new Error("The fund has no dollar to convert");
  const entry = currencyOf(fund.currency)?.dollar;
  if (entry === null || entry === undefined) throw new Error(`The agent has no pool fee for the fund's currency ${fund.currency}`);
  const twap =
    fund.version === 2
      ? celo.readContract({ address: fund.address, abi: fundV2Abi, functionName: "quoteDollar", args: [dollarAmount] })
      : celo.readContract({ address: fund.address, abi: fundAbi, functionName: "quoteUsdtInWars", args: [dollarAmount] });
  const [quote, twapCurrency, poolCurrency] = await Promise.all([
    celo.simulateContract({
      address: UNISWAP_V3_QUOTER,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: dollar, tokenOut: fund.currency, amountIn: dollarAmount, fee: entry.poolFee, sqrtPriceLimitX96: 0n }],
    }),
    twap,
    celo.readContract({ address: fund.currency, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
  ]);
  return { dollarAmount, quotedCurrency: quote.result[0], twapCurrency, poolCurrency };
}
