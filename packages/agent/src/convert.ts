import type { Address } from "viem";
import type { Currency } from "./currencies";
import type { FundSnapshot } from "./fund";
import { type DailyActivity, conversionLimits } from "./limits";
import type { ConversionQuote, References } from "./market";

/** Under 5 USDT, the agent leaves the USDT where it is (spec, 8.1). */
export const MIN_CONVERSION_USDT = 5_000_000n;
/** The pool must hold at least this many times the currency a conversion takes. */
export const POOL_DEPTH_MULTIPLE = 10n;
/** How far the pool's price may be from Chainlink's, in basis points. */
export const MAX_REFERENCE_DEVIATION_BPS = 200n;
/**
 * Chainlink's USDT / USD on Celo: older than 26 hours, the agent waits. The currency's own feed has its age in the
 * table (`reference.maxAge`), since each one updates at its own pace.
 */
export const DOLLAR_REFERENCE_MAX_AGE = 26n * 3_600n;
/** How far ahead of the agent's clock a Chainlink update may be dated, in seconds. */
export const MAX_CLOCK_SKEW = 300n;
/** `minCurrencyOut` sits this far under the quote, not at the contract's 2% floor (spec, 8.1). */
export const SLIPPAGE_BPS = 50n;
/** `convert` reverts if `minCurrencyOut` is under 98% of the fund's TWAP quote. */
const CONTRACT_FLOOR_BPS = 9_800n;
const BPS = 10_000n;

/**
 * Why the agent left a fund's USDT unconverted this time (spec, 8.1). The web says it in its own words (F8) and never
 * reads `reason`, which is for the log.
 */
export type SkipCode = "daily-limit" | "price-reference" | "pool-depth" | "price-gap" | "price-floor";

/**
 * What to do about a fund's dollars: nothing, wait for a reason, or ask for a quote of `dollarAmount`. In a version 2
 * fund, a quote also says whose dollars and how much of each (`members` and `amounts`, in the contract's order).
 */
export type ConversionPlan =
  | { kind: "none" }
  | { kind: "skip"; code: SkipCode; reason: string }
  | { kind: "quote"; dollarAmount: bigint; members?: Address[]; amounts?: bigint[] };

/**
 * How much of the fund's dollars to convert now, within the agent's limits. A version 1 fund converts all it holds. In
 * version 2 only what members have pending counts (what was sent straight to the fund is nobody's, so it stays), and
 * it's taken from the members in the contract's order, the last one possibly with only part of what they have pending.
 */
export function planConversion(fund: FundSnapshot, today: DailyActivity): ConversionPlan {
  const waiting = fund.version === 2 ? fund.pendingDollar.reduce((sum, amount) => sum + amount, 0n) : fund.dollarBalance;
  if (waiting < MIN_CONVERSION_USDT) return { kind: "none" };
  const { perConversion, perDay } = conversionLimits(fund);
  let dollarAmount = waiting;
  if (dollarAmount > perConversion) dollarAmount = perConversion;
  const leftToday = perDay - today.convertedDollar;
  if (dollarAmount > leftToday) dollarAmount = leftToday;
  if (dollarAmount < MIN_CONVERSION_USDT) {
    return { kind: "skip", code: "daily-limit", reason: "The agent reached its daily conversion limit for this fund" };
  }
  if (fund.version !== 2) return { kind: "quote", dollarAmount };
  const members: Address[] = [];
  const amounts: bigint[] = [];
  let left = dollarAmount;
  fund.members.forEach((member, i) => {
    const pending = fund.pendingDollar[i] ?? 0n;
    if (left === 0n || pending === 0n) return;
    const amount = pending < left ? pending : left;
    members.push(member);
    amounts.push(amount);
    left -= amount;
  });
  return { kind: "quote", dollarAmount, members, amounts };
}

export type ConversionDecision =
  | { kind: "convert"; dollarAmount: bigint; minCurrencyOut: bigint }
  | { kind: "skip"; code: SkipCode; reason: string };

function percent(bps: bigint): string {
  return (Number(bps) / 100).toFixed(2);
}

/** How long a feed has gone without an update and how long it may, in hours ("26.0 hours old (26 at most)") or, under an hour, minutes. */
function agedText(age: bigint, maxAge: bigint): string {
  const [unit, seconds] = maxAge >= 3_600n ? (["hours", 3_600] as const) : (["minutes", 60] as const);
  return `${(Number(age) / seconds).toFixed(1)} ${unit} old (${Number(maxAge) / seconds} at most)`;
}

/**
 * Whether to convert at this quote (spec, 8.1): Chainlink is fresh, the pool is deep enough, and its price is
 * close to Chainlink's. If so, `minCurrencyOut` is the quote less SLIPPAGE_BPS, and never under the contract's floor.
 * `currency` is the fund's: its table entry says which way its feed is quoted, how old it may be, and each token's
 * decimals.
 */
export function decideConversion({
  quote,
  references,
  currency,
  now,
}: {
  quote: ConversionQuote;
  references: References;
  currency: Currency;
  now: bigint;
}): ConversionDecision {
  const { reference, dollar } = currency;
  if (reference === null) {
    return { kind: "skip", code: "price-reference", reason: `The agent has no price reference for ${currency.symbol}` };
  }
  // `planConversion` has no quote to ask for in a fund without a dollar, so this is never reached with one.
  if (dollar === null) throw new Error(`${currency.symbol} has no dollar to convert`);
  const { currencyUsd, dollarUsd } = references;
  // "USD / ARS" for a feed in pesos per dollar, "MXN / USD" for one in dollars per peso.
  const code = currency.symbol.slice(1);
  const currencyFeed = reference.perUsd ? `USD / ${code}` : `${code} / USD`;
  for (const [name, feed, maxAge] of [
    [currencyFeed, currencyUsd, reference.maxAge],
    ["USDT / USD", dollarUsd, DOLLAR_REFERENCE_MAX_AGE],
  ] as const) {
    if (feed.answer <= 0n) return { kind: "skip", code: "price-reference", reason: `Chainlink's ${name} has no valid price` };
    // A date ahead of the clock would pass any age check: beyond the clock skew allowed, the price isn't trusted.
    if (feed.updatedAt > now + MAX_CLOCK_SKEW) return { kind: "skip", code: "price-reference", reason: `Chainlink's ${name} is dated in the future` };
    const age = now - feed.updatedAt;
    if (age > maxAge) return { kind: "skip", code: "price-reference", reason: `Chainlink's ${name} is ${agedText(age, maxAge)}` };
  }
  if (quote.poolCurrency < POOL_DEPTH_MULTIPLE * quote.quotedCurrency) {
    return { kind: "skip", code: "pool-depth", reason: `The pool holds less than 10 times the ${currency.symbol} this conversion takes` };
  }
  // The currency per dollar by Chainlink: its feed (either way round) times USD per dollar, with the dollar's units
  // turned into the currency's by the decimals of the table.
  const units = quote.dollarAmount * 10n ** BigInt(currency.decimals - dollar.decimals);
  const referenceCurrency = reference.perUsd
    ? (units * currencyUsd.answer * dollarUsd.answer) / 10n ** BigInt(currencyUsd.decimals + dollarUsd.decimals)
    : (units * 10n ** BigInt(currencyUsd.decimals) * dollarUsd.answer) / (currencyUsd.answer * 10n ** BigInt(dollarUsd.decimals));
  const gap = quote.quotedCurrency > referenceCurrency ? quote.quotedCurrency - referenceCurrency : referenceCurrency - quote.quotedCurrency;
  const gapBps = (gap * BPS) / referenceCurrency;
  if (gapBps > MAX_REFERENCE_DEVIATION_BPS) {
    return { kind: "skip", code: "price-gap", reason: `The pool's price is ${percent(gapBps)}% away from Chainlink's (2% at most)` };
  }
  const floor = (quote.twapCurrency * CONTRACT_FLOOR_BPS) / BPS;
  if (quote.quotedCurrency < floor) {
    return { kind: "skip", code: "price-floor", reason: "The pool pays less than the contract's floor, 2% under its 30-minute TWAP" };
  }
  const nearQuote = (quote.quotedCurrency * (BPS - SLIPPAGE_BPS)) / BPS;
  return { kind: "convert", dollarAmount: quote.dollarAmount, minCurrencyOut: nearQuote > floor ? nearQuote : floor };
}
