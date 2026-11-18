import type { FundSnapshot } from "./fund";
import { type DailyActivity, conversionLimits } from "./limits";
import type { ConversionQuote, References } from "./market";

/** Under 5 USDT, the agent leaves the USDT where it is (spec, 8.1). */
export const MIN_CONVERSION_USDT = 5_000_000n;
/** The pool must hold at least this many times the wARS a conversion takes. */
export const POOL_DEPTH_MULTIPLE = 10n;
/** How far the pool's price may be from Chainlink's, in basis points. */
export const MAX_REFERENCE_DEVIATION_BPS = 200n;
/** Chainlink's USD / ARS on Base updates about once a day: older than 26 hours, the agent waits. */
export const MAX_REFERENCE_AGE = 26n * 3_600n;
/** How far ahead of the agent's clock a Chainlink update may be dated, in seconds. */
export const MAX_CLOCK_SKEW = 300n;
/** `minCurrencyOut` sits this far under the quote, not at the contract's 2% floor (spec, 8.1). */
export const SLIPPAGE_BPS = 50n;
/** `Fund.convert` reverts if `minCurrencyOut` is under 98% of the fund's TWAP quote. */
const CONTRACT_FLOOR_BPS = 9_800n;
const BPS = 10_000n;

/**
 * Why the agent left a fund's USDT unconverted this time (spec, 8.1). The web says it in its own words (F8) and never
 * reads `reason`, which is for the log.
 */
export type SkipCode = "daily-limit" | "price-reference" | "pool-depth" | "price-gap" | "price-floor";

export type ConversionPlan = { kind: "none" } | { kind: "skip"; code: SkipCode; reason: string } | { kind: "quote"; dollarAmount: bigint };

/** How much of the fund's USDT to convert now: all of it, within the agent's limits. */
export function planConversion(fund: FundSnapshot, today: DailyActivity): ConversionPlan {
  if (fund.dollarBalance < MIN_CONVERSION_USDT) return { kind: "none" };
  const { perConversion, perDay } = conversionLimits(fund);
  let dollarAmount = fund.dollarBalance;
  if (dollarAmount > perConversion) dollarAmount = perConversion;
  const leftToday = perDay - today.convertedDollar;
  if (dollarAmount > leftToday) dollarAmount = leftToday;
  if (dollarAmount < MIN_CONVERSION_USDT) {
    return { kind: "skip", code: "daily-limit", reason: "The agent reached its daily conversion limit for this fund" };
  }
  return { kind: "quote", dollarAmount };
}

export type ConversionDecision =
  | { kind: "convert"; dollarAmount: bigint; minCurrencyOut: bigint }
  | { kind: "skip"; code: SkipCode; reason: string };

function percent(bps: bigint): string {
  return (Number(bps) / 100).toFixed(2);
}

/**
 * Whether to convert at this quote (spec, 8.1): Chainlink is fresh, the pool is deep enough, and its price is
 * close to Chainlink's. If so, `minCurrencyOut` is the quote less SLIPPAGE_BPS, and never under the contract's floor.
 */
export function decideConversion({
  quote,
  references,
  now,
}: {
  quote: ConversionQuote;
  references: References;
  now: bigint;
}): ConversionDecision {
  const { usdArs, usdtUsd } = references;
  for (const [name, feed] of [
    ["USD / ARS", usdArs],
    ["USDT / USD", usdtUsd],
  ] as const) {
    if (feed.answer <= 0n) return { kind: "skip", code: "price-reference", reason: `Chainlink's ${name} has no valid price` };
    // A date ahead of the clock would pass any age check: beyond the clock skew allowed, the price isn't trusted.
    if (feed.updatedAt > now + MAX_CLOCK_SKEW) return { kind: "skip", code: "price-reference", reason: `Chainlink's ${name} is dated in the future` };
    const age = now - feed.updatedAt;
    if (age > MAX_REFERENCE_AGE) {
      return { kind: "skip", code: "price-reference", reason: `Chainlink's ${name} is ${(Number(age) / 3_600).toFixed(1)} hours old (26 at most)` };
    }
  }
  if (quote.poolCurrency < POOL_DEPTH_MULTIPLE * quote.quotedCurrency) {
    return { kind: "skip", code: "pool-depth", reason: "The pool holds less than 10 times the wARS this conversion takes" };
  }
  // wARS per USDT by Chainlink, (ARS per USD) × (USD per USDT), and from USDT's 6 decimals to wARS's 18.
  const referenceWars =
    (quote.dollarAmount * 10n ** 12n * usdArs.answer * usdtUsd.answer) / 10n ** BigInt(usdArs.decimals + usdtUsd.decimals);
  const gap = quote.quotedCurrency > referenceWars ? quote.quotedCurrency - referenceWars : referenceWars - quote.quotedCurrency;
  const gapBps = (gap * BPS) / referenceWars;
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
