import { describe, expect, it } from "vitest";
import { MAX_CLOCK_SKEW, MAX_REFERENCE_AGE, decideConversion, planConversion } from "../src/convert";
import type { ConversionQuote, References } from "../src/market";
import { USDT_UNIT, WARS_UNIT, fundSnapshot } from "./support/fixtures";

// Celo and Base on 2026-10-09: 300 USDT quoted at 482,243.29 wARS, USD / ARS 1,607.9032 and USDT / USD 0.99913512.
const NOW = 1_791_561_510n;
const QUOTE: ConversionQuote = {
  dollarAmount: 300n * USDT_UNIT,
  quotedCurrency: 482_243_292_884_944_290_611_892n,
  twapCurrency: 482_300_000_000_000_000_000_000n,
  poolCurrency: 106_669_036_955_606_543_270_134_078n,
};
const REFERENCES: References = {
  usdArs: { answer: 160_790_320_000n, decimals: 8, updatedAt: 1_791_555_995n },
  usdtUsd: { answer: 99_913_512n, decimals: 8, updatedAt: 1_791_561_336n },
};
const QUIET_DAY = { reimbursed: 0n, convertedDollar: 0n, transactions: 0 };

describe("planConversion", () => {
  it("does nothing under 5 USDT", () => {
    expect(planConversion(fundSnapshot({ dollarBalance: 4_999_999n }), QUIET_DAY)).toEqual({ kind: "none" });
  });

  it("converts all of it, up to the per-conversion limit", () => {
    expect(planConversion(fundSnapshot({ dollarBalance: 5n * USDT_UNIT }), QUIET_DAY)).toEqual({
      kind: "quote",
      dollarAmount: 5n * USDT_UNIT,
    });
    expect(planConversion(fundSnapshot({ dollarBalance: 800n * USDT_UNIT }), QUIET_DAY)).toEqual({
      kind: "quote",
      dollarAmount: 500n * USDT_UNIT,
    });
  });

  it("converts only what the daily limit leaves, and says so when that's under 5 USDT", () => {
    const fund = fundSnapshot({ dollarBalance: 300n * USDT_UNIT });
    const afterMost = { ...QUIET_DAY, convertedDollar: 1_000n * USDT_UNIT - 100n * USDT_UNIT };
    expect(planConversion(fund, afterMost)).toEqual({ kind: "quote", dollarAmount: 100n * USDT_UNIT });
    const afterAll = { ...QUIET_DAY, convertedDollar: 1_000n * USDT_UNIT - 4n * USDT_UNIT };
    expect(planConversion(fund, afterAll)).toEqual({ kind: "skip", code: "daily-limit", reason: expect.stringContaining("daily conversion limit") });
  });
});

describe("decideConversion", () => {
  it("converts at 2026-10-09's prices, with minCurrencyOut 0.5% under the quote", () => {
    expect(decideConversion({ quote: QUOTE, references: REFERENCES, now: NOW })).toEqual({
      kind: "convert",
      dollarAmount: 300n * USDT_UNIT,
      minCurrencyOut: (QUOTE.quotedCurrency * 9_950n) / 10_000n,
    });
  });

  it("waits while USD / ARS is more than 26 hours old", () => {
    const at = (age: bigint) =>
      decideConversion({ quote: QUOTE, references: REFERENCES, now: REFERENCES.usdArs.updatedAt + age });
    expect(at(MAX_REFERENCE_AGE).kind).toBe("convert");
    expect(at(MAX_REFERENCE_AGE + 1n)).toEqual({ kind: "skip", code: "price-reference", reason: "Chainlink's USD / ARS is 26.0 hours old (26 at most)" });
  });

  it("waits on a stale or broken USDT / USD too", () => {
    const stale = { ...REFERENCES, usdtUsd: { ...REFERENCES.usdtUsd, updatedAt: NOW - MAX_REFERENCE_AGE - 1n } };
    expect(decideConversion({ quote: QUOTE, references: stale, now: NOW }).kind).toBe("skip");
    const broken = { ...REFERENCES, usdtUsd: { ...REFERENCES.usdtUsd, answer: 0n } };
    expect(decideConversion({ quote: QUOTE, references: broken, now: NOW })).toEqual({
      kind: "skip",
      code: "price-reference",
      reason: "Chainlink's USDT / USD has no valid price",
    });
  });

  it("waits on a price dated ahead of its clock, beyond five minutes of skew", () => {
    const at = (ahead: bigint) => {
      const references = { ...REFERENCES, usdArs: { ...REFERENCES.usdArs, updatedAt: NOW + ahead } };
      return decideConversion({ quote: QUOTE, references, now: NOW });
    };
    expect(at(MAX_CLOCK_SKEW).kind).toBe("convert");
    expect(at(MAX_CLOCK_SKEW + 1n)).toEqual({ kind: "skip", code: "price-reference", reason: "Chainlink's USD / ARS is dated in the future" });
  });

  it("waits when the pool holds less than 10 times the wARS the conversion takes", () => {
    const shallow = { ...QUOTE, poolCurrency: QUOTE.quotedCurrency * 10n - 1n };
    expect(decideConversion({ quote: shallow, references: REFERENCES, now: NOW })).toEqual({
      kind: "skip",
      code: "pool-depth",
      reason: "The pool holds less than 10 times the wARS this conversion takes",
    });
  });

  it("waits when the pool's price is more than 2% away from Chainlink's, either way", () => {
    // Chainlink's reference for 300 USDT is ~481,953.8 wARS.
    for (const quotedCurrency of [470_000n * WARS_UNIT, 492_000n * WARS_UNIT]) {
      const quote = { ...QUOTE, quotedCurrency, twapCurrency: quotedCurrency };
      const decision = decideConversion({ quote, references: REFERENCES, now: NOW });
      expect(decision).toEqual({ kind: "skip", code: "price-gap", reason: expect.stringContaining("away from Chainlink's (2% at most)") });
    }
  });

  it("waits when the pool pays less than the contract's floor, and never sets minCurrencyOut under it", () => {
    const under = { ...QUOTE, twapCurrency: (QUOTE.quotedCurrency * 10_000n) / 9_799n };
    expect(decideConversion({ quote: under, references: REFERENCES, now: NOW })).toEqual({
      kind: "skip",
      code: "price-floor",
      reason: "The pool pays less than the contract's floor, 2% under its 30-minute TWAP",
    });
    // Quote 0.1% over the floor: 0.5% under the quote would be under the floor, so the floor it is.
    const tight = { ...QUOTE, twapCurrency: (QUOTE.quotedCurrency * 10_000n) / 9_810n };
    const decision = decideConversion({ quote: tight, references: REFERENCES, now: NOW });
    expect(decision).toEqual({ kind: "convert", dollarAmount: QUOTE.dollarAmount, minCurrencyOut: (tight.twapCurrency * 9_800n) / 10_000n });
  });
});
