import type { FundSnapshot } from "./fund";
import { type DailyActivity, LIMITS } from "./limits";
import type { ConversionQuote, References } from "./market";

/** Under 5 USDT, the agent leaves the USDT where it is (spec, 8.1). */
export const MIN_CONVERSION_USDT = 5_000_000n;
/** The pool must hold at least this many times the wARS a conversion takes. */
export const POOL_DEPTH_MULTIPLE = 10n;
/** How far the pool's price may be from Chainlink's, in basis points. */
export const MAX_REFERENCE_DEVIATION_BPS = 200n;
/** Chainlink's USD / ARS on Base updates about once a day: older than 26 hours, the agent waits. */
export const MAX_REFERENCE_AGE = 26n * 3_600n;
/** `minWarsOut` sits this far under the quote, not at the contract's 2% floor (spec, 8.1). */
export const SLIPPAGE_BPS = 50n;
/** `Fund.convert` reverts if `minWarsOut` is under 98% of the fund's TWAP quote. */
const CONTRACT_FLOOR_BPS = 9_800n;
const BPS = 10_000n;

export type ConversionPlan = { kind: "none" } | { kind: "skip"; reason: string } | { kind: "quote"; usdtAmount: bigint };

/** How much of the fund's USDT to convert now: all of it, within the agent's limits. */
export function planConversion(fund: FundSnapshot, today: DailyActivity): ConversionPlan {
  if (fund.usdtBalance < MIN_CONVERSION_USDT) return { kind: "none" };
  let usdtAmount = fund.usdtBalance;
  if (usdtAmount > LIMITS.maxConversionUsdt) usdtAmount = LIMITS.maxConversionUsdt;
  const leftToday = LIMITS.maxDailyConvertedUsdt - today.convertedUsdt;
  if (usdtAmount > leftToday) usdtAmount = leftToday;
  if (usdtAmount < MIN_CONVERSION_USDT) {
    return { kind: "skip", reason: "The agent reached its daily conversion limit for this fund" };
  }
  return { kind: "quote", usdtAmount };
}

export type ConversionDecision =
  | { kind: "convert"; usdtAmount: bigint; minWarsOut: bigint }
  | { kind: "skip"; reason: string };

function percent(bps: bigint): string {
  return (Number(bps) / 100).toFixed(2);
}

/**
 * Whether to convert at this quote (spec, 8.1): Chainlink is fresh, the pool is deep enough, and its price is
 * close to Chainlink's. If so, `minWarsOut` is the quote less SLIPPAGE_BPS, and never under the contract's floor.
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
    if (feed.answer <= 0n) return { kind: "skip", reason: `Chainlink's ${name} has no valid price` };
    const age = now - feed.updatedAt;
    if (age > MAX_REFERENCE_AGE) {
      return { kind: "skip", reason: `Chainlink's ${name} is ${(Number(age) / 3_600).toFixed(1)} hours old (26 at most)` };
    }
  }
  if (quote.poolWars < POOL_DEPTH_MULTIPLE * quote.quotedWars) {
    return { kind: "skip", reason: "The pool holds less than 10 times the wARS this conversion takes" };
  }
  // wARS per USDT by Chainlink, (ARS per USD) × (USD per USDT), and from USDT's 6 decimals to wARS's 18.
  const referenceWars =
    (quote.usdtAmount * 10n ** 12n * usdArs.answer * usdtUsd.answer) / 10n ** BigInt(usdArs.decimals + usdtUsd.decimals);
  const gap = quote.quotedWars > referenceWars ? quote.quotedWars - referenceWars : referenceWars - quote.quotedWars;
  const gapBps = (gap * BPS) / referenceWars;
  if (gapBps > MAX_REFERENCE_DEVIATION_BPS) {
    return { kind: "skip", reason: `The pool's price is ${percent(gapBps)}% away from Chainlink's (2% at most)` };
  }
  const floor = (quote.twapWars * CONTRACT_FLOOR_BPS) / BPS;
  if (quote.quotedWars < floor) {
    return { kind: "skip", reason: "The pool pays less than the contract's floor, 2% under its 30-minute TWAP" };
  }
  const nearQuote = (quote.quotedWars * (BPS - SLIPPAGE_BPS)) / BPS;
  return { kind: "convert", usdtAmount: quote.usdtAmount, minWarsOut: nearQuote > floor ? nearQuote : floor };
}
