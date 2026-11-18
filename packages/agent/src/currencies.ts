import { type Address, formatUnits, isAddressEqual } from "viem";
import { POOL, POOL_FEE, USDT, USD_ARS_FEED, WARS } from "./chain";
// Type only, so the two files have no import cycle at runtime.
import type { FundSnapshot } from "./fund";

/** A Chainlink price the agent checks a currency against. */
export type ReferenceFeed = {
  chain: "celo" | "base";
  feed: Address;
  /** True when the feed gives units of the currency per dollar (ARS), false when it gives dollars per unit. */
  perUsd: boolean;
  /** How old, in seconds, an update may be before the agent waits. */
  maxAge: bigint;
};

/** How a fund gets dollars in and turns them into the currency: the token and the Uniswap v3 pool. */
export type DollarEntry = { token: Address; decimals: number; pool: Address; poolFee: number };

export type Currency = {
  symbol: "wARS" | "wBRL" | "wMXN" | "wCOP" | "wPEN" | "wCLP";
  token: Address;
  decimals: number;
  country: "AR" | "BR" | "MX" | "CO" | "PE" | "CL";
  /** The token's name in Ripio's ramp, or null where the ramp doesn't serve the country. */
  rampToken: string | null;
  reference: ReferenceFeed | null;
  dollar: DollarEntry | null;
  /** In the token's units. */
  limits: { reimbursement: bigint; dailyReimbursed: bigint; balanceCap: bigint };
  /** Whether the web lets a group pick it for a new fund. */
  offered: boolean;
};

/** The fee the web sets on the funds it creates, in basis points (the contract allows up to 100). */
export const FEE_BPS = 25;
/** The pool's oldest stored observation must be at least this old, in seconds (6 hours). */
export const MIN_POOL_HISTORY = 21_600n;

const UNIT = 10n ** 18n;

/** Chainlink's USD / ARS on Base updates about once a day: 26 hours, as `MAX_REFERENCE_AGE` in convert.ts. */
const ARS_MAX_AGE = 93_600n;
/** BRL / USD and COP / USD on Celo have a 240 s heartbeat: 10 minutes. */
const FAST_MAX_AGE = 600n;
/** MXN / USD on Base has a 1 h heartbeat: 2 hours. */
const MXN_MAX_AGE = 7_200n;

/**
 * The six wFIAT Ripio issues on Celo, all with 18 decimals. Limits come from the spec (section 6): the dollar
 * equivalents of wARS's, at Chainlink's prices of 16/11/2026, rounded. wARS's are the agent's today.
 */
export const CURRENCIES: readonly Currency[] = [
  {
    symbol: "wARS",
    token: WARS,
    decimals: 18,
    country: "AR",
    rampToken: "WARS",
    reference: { chain: "base", feed: USD_ARS_FEED, perUsd: true, maxAge: ARS_MAX_AGE },
    dollar: { token: USDT, decimals: 6, pool: POOL, poolFee: POOL_FEE },
    limits: { reimbursement: 100_000n * UNIT, dailyReimbursed: 150_000n * UNIT, balanceCap: 450_000n * UNIT },
    offered: true,
  },
  {
    symbol: "wBRL",
    token: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0",
    decimals: 18,
    country: "BR",
    rampToken: "WBRL",
    reference: { chain: "celo", feed: "0xe8EcaF727080968Ed5F6DBB595B91e50eEb9F8B3", perUsd: false, maxAge: FAST_MAX_AGE },
    dollar: null,
    limits: { reimbursement: 350n * UNIT, dailyReimbursed: 500n * UNIT, balanceCap: 1_500n * UNIT },
    offered: false,
  },
  {
    symbol: "wMXN",
    token: "0x337E7456B420bD3481e7FA61fA9850343d610d34",
    decimals: 18,
    country: "MX",
    rampToken: "WMXN",
    reference: { chain: "base", feed: "0x9e8Ee77c76d4fa41306056D1C3196AF5da1600bd", perUsd: false, maxAge: MXN_MAX_AGE },
    dollar: null,
    limits: { reimbursement: 1_100n * UNIT, dailyReimbursed: 1_650n * UNIT, balanceCap: 5_000n * UNIT },
    offered: false,
  },
  {
    symbol: "wCOP",
    token: "0x8a1D45e102e886510e891d2Ec656a708991e2D76",
    decimals: 18,
    country: "CO",
    rampToken: "WCOP",
    reference: { chain: "celo", feed: "0x97b770B0200CCe161907a9cbe0C6B177679f8F7C", perUsd: false, maxAge: FAST_MAX_AGE },
    dollar: null,
    limits: { reimbursement: 200_000n * UNIT, dailyReimbursed: 300_000n * UNIT, balanceCap: 900_000n * UNIT },
    offered: false,
  },
  {
    symbol: "wPEN",
    token: "0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE",
    decimals: 18,
    country: "PE",
    rampToken: null,
    reference: null,
    dollar: null,
    limits: { reimbursement: 200n * UNIT, dailyReimbursed: 300n * UNIT, balanceCap: 900n * UNIT },
    offered: false,
  },
  {
    symbol: "wCLP",
    token: "0x61D450a098b6a7f69fC4b98CE68198fe59768651",
    decimals: 18,
    country: "CL",
    rampToken: null,
    reference: null,
    dollar: null,
    limits: { reimbursement: 60_000n * UNIT, dailyReimbursed: 90_000n * UNIT, balanceCap: 250_000n * UNIT },
    offered: false,
  },
];

/** The currency whose token is `token`, whatever the address's case, or undefined for any other token. */
export function currencyOf(token: Address): Currency | undefined {
  return CURRENCIES.find((c) => isAddressEqual(c.token, token));
}

/**
 * Why the agent doesn't serve this fund, or null when it does. A v1 fund always is: they're the ones the agent has run
 * since the start. A v2 fund is only if it matches the table: its currency is in it, its dollar and pool are both the
 * currency's or both missing, and its balance cap is no more than the currency's. Anyone can deploy a fund that names
 * this agent, with a pool of their own or a cap the agent's limits weren't sized for. The fee isn't compared: the
 * contract caps it at 1 %, so a fund stays served when the table's FEE_BPS changes for the funds created after.
 */
export function servedProblem(fund: FundSnapshot): string | null {
  if (fund.version === 1) return null;
  const currency = currencyOf(fund.currency);
  if (currency === undefined) return `The fund's currency ${fund.currency} isn't in the agent's table`;
  const { dollar } = currency;
  const noDollar = fund.dollar === null && fund.pool === null;
  const tablesDollar =
    dollar !== null &&
    fund.dollar !== null &&
    isAddressEqual(fund.dollar, dollar.token) &&
    fund.pool !== null &&
    isAddressEqual(fund.pool, dollar.pool);
  if (!noDollar && !tablesDollar) return `The fund's dollar and pool aren't the ones the agent uses for ${currency.symbol}`;
  if (fund.balanceCap > currency.limits.balanceCap) {
    return `The fund's balance cap is above the ${formatUnits(currency.limits.balanceCap, currency.decimals)} ${currency.symbol} the agent serves`;
  }
  return null;
}
