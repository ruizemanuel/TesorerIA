import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { WARS } from "../src/chain";
import { DOLLAR_REFERENCE_MAX_AGE, MAX_CLOCK_SKEW, decideConversion, planConversion } from "../src/convert";
import { type Currency, type ReferenceFeed, currencyOf } from "../src/currencies";
import type { ConversionQuote, References } from "../src/market";
import { MEMBERS, USDT_UNIT, WARS_UNIT, fundSnapshot, fundSnapshotWithPending } from "./support/fixtures";

// Celo and Base on 2026-10-09: 300 USDT quoted at 482,243.29 wARS, USD / ARS 1,607.9032 and USDT / USD 0.99913512.
const NOW = 1_791_561_510n;
const QUOTE: ConversionQuote = {
  dollarAmount: 300n * USDT_UNIT,
  quotedCurrency: 482_243_292_884_944_290_611_892n,
  twapCurrency: 482_300_000_000_000_000_000_000n,
  poolCurrency: 106_669_036_955_606_543_270_134_078n,
};
const REFERENCES: References = {
  currencyUsd: { answer: 160_790_320_000n, decimals: 8, updatedAt: 1_791_555_995n },
  dollarUsd: { answer: 99_913_512n, decimals: 8, updatedAt: 1_791_561_336n },
};
const QUIET_DAY = { reimbursed: 0n, convertedDollar: 0n, transactions: 0 };
const WARS_CURRENCY = currencyOf(WARS) as Currency;
const WARS_MAX_AGE = (WARS_CURRENCY.reference as ReferenceFeed).maxAge;
const [ANA, BETO] = MEMBERS as [Address, Address, Address];

/** The currency with part of its reference changed. */
function withReference(currency: Currency, change: Partial<ReferenceFeed>): Currency {
  return { ...currency, reference: { ...(currency.reference as ReferenceFeed), ...change } };
}

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

  it("converts a v2 fund's pending dollars once they add up to 5 USDT", () => {
    // Nobody with 0 pending is named, and the amounts are exactly what each member has pending.
    const fund = fundSnapshotWithPending([3n * USDT_UNIT, 2n * USDT_UNIT, 0n]);
    expect(planConversion(fund, QUIET_DAY)).toEqual({
      kind: "quote",
      dollarAmount: 5n * USDT_UNIT,
      members: [ANA, BETO],
      amounts: [3n * USDT_UNIT, 2n * USDT_UNIT],
    });
  });

  it("leaves 4.99 USDT pending among all members where they are", () => {
    expect(planConversion(fundSnapshotWithPending([2_500_000n, 2_490_000n, 0n]), QUIET_DAY)).toEqual({ kind: "none" });
    // What was sent straight to the fund is nobody's: it never gets converted, however much it is.
    const sentDirectly = fundSnapshotWithPending([2_500_000n, 2_490_000n, 0n], { dollarBalance: 300n * USDT_UNIT });
    expect(planConversion(sentDirectly, QUIET_DAY)).toEqual({ kind: "none" });
  });

  it("takes members in the contract's order up to the per-conversion limit", () => {
    const fund = fundSnapshotWithPending([400n * USDT_UNIT, 300n * USDT_UNIT, 0n]);
    expect(planConversion(fund, QUIET_DAY)).toEqual({
      kind: "quote",
      dollarAmount: 500n * USDT_UNIT,
      members: [ANA, BETO],
      amounts: [400n * USDT_UNIT, 100n * USDT_UNIT],
    });
  });

  it("stays within what's left of the day", () => {
    const fund = fundSnapshotWithPending([400n * USDT_UNIT, 300n * USDT_UNIT, 0n]);
    const after800 = { ...QUIET_DAY, convertedDollar: 800n * USDT_UNIT };
    expect(planConversion(fund, after800)).toEqual({
      kind: "quote",
      dollarAmount: 200n * USDT_UNIT,
      members: [ANA],
      amounts: [200n * USDT_UNIT],
    });
    // Under 5 USDT left, it says so, as in v1.
    const after998 = { ...QUIET_DAY, convertedDollar: 998n * USDT_UNIT };
    expect(planConversion(fund, after998)).toEqual({ kind: "skip", code: "daily-limit", reason: expect.stringContaining("daily conversion limit") });
  });
});

describe("decideConversion", () => {
  const decide = (change: { quote?: ConversionQuote; references?: References; currency?: Currency; now?: bigint } = {}) =>
    decideConversion({ quote: QUOTE, references: REFERENCES, currency: WARS_CURRENCY, now: NOW, ...change });

  it("converts at 2026-10-09's prices, with minCurrencyOut 0.5% under the quote", () => {
    expect(decide()).toEqual({
      kind: "convert",
      dollarAmount: 300n * USDT_UNIT,
      minCurrencyOut: (QUOTE.quotedCurrency * 9_950n) / 10_000n,
    });
  });

  it("waits while USD / ARS is more than 26 hours old", () => {
    const at = (age: bigint) => decide({ now: REFERENCES.currencyUsd.updatedAt + age });
    expect(at(WARS_MAX_AGE).kind).toBe("convert");
    expect(at(WARS_MAX_AGE + 1n)).toEqual({ kind: "skip", code: "price-reference", reason: "Chainlink's USD / ARS is 26.0 hours old (26 at most)" });
  });

  it("waits on a stale or broken USDT / USD too", () => {
    const stale = { ...REFERENCES, dollarUsd: { ...REFERENCES.dollarUsd, updatedAt: NOW - DOLLAR_REFERENCE_MAX_AGE - 1n } };
    expect(decide({ references: stale }).kind).toBe("skip");
    const broken = { ...REFERENCES, dollarUsd: { ...REFERENCES.dollarUsd, answer: 0n } };
    expect(decide({ references: broken })).toEqual({
      kind: "skip",
      code: "price-reference",
      reason: "Chainlink's USDT / USD has no valid price",
    });
  });

  it("waits on a price dated ahead of its clock, beyond five minutes of skew", () => {
    const at = (ahead: bigint) => decide({ references: { ...REFERENCES, currencyUsd: { ...REFERENCES.currencyUsd, updatedAt: NOW + ahead } } });
    expect(at(MAX_CLOCK_SKEW).kind).toBe("convert");
    expect(at(MAX_CLOCK_SKEW + 1n)).toEqual({ kind: "skip", code: "price-reference", reason: "Chainlink's USD / ARS is dated in the future" });
  });

  it("waits when the pool holds less than 10 times the wARS the conversion takes", () => {
    const shallow = { ...QUOTE, poolCurrency: QUOTE.quotedCurrency * 10n - 1n };
    expect(decide({ quote: shallow })).toEqual({
      kind: "skip",
      code: "pool-depth",
      reason: "The pool holds less than 10 times the wARS this conversion takes",
    });
  });

  it("waits when the pool's price is more than 2% away from Chainlink's, either way", () => {
    // Chainlink's reference for 300 USDT is ~481,953.8 wARS.
    for (const quotedCurrency of [470_000n * WARS_UNIT, 492_000n * WARS_UNIT]) {
      const quote = { ...QUOTE, quotedCurrency, twapCurrency: quotedCurrency };
      expect(decide({ quote })).toEqual({ kind: "skip", code: "price-gap", reason: expect.stringContaining("away from Chainlink's (2% at most)") });
    }
  });

  it("waits when the pool pays less than the contract's floor, and never sets minCurrencyOut under it", () => {
    const under = { ...QUOTE, twapCurrency: (QUOTE.quotedCurrency * 10_000n) / 9_799n };
    expect(decide({ quote: under })).toEqual({
      kind: "skip",
      code: "price-floor",
      reason: "The pool pays less than the contract's floor, 2% under its 30-minute TWAP",
    });
    // Quote 0.1% over the floor: 0.5% under the quote would be under the floor, so the floor it is.
    const tight = { ...QUOTE, twapCurrency: (QUOTE.quotedCurrency * 10_000n) / 9_810n };
    expect(decide({ quote: tight })).toEqual({ kind: "convert", dollarAmount: QUOTE.dollarAmount, minCurrencyOut: (tight.twapCurrency * 9_800n) / 10_000n });
  });

  describe("with another currency's reference", () => {
    // A peso quoted in dollars per unit, like BRL / USD or MXN / USD, with the wARS pool standing in for its own.
    const dollarsPerUnit: Currency = { ...withReference(WARS_CURRENCY, { perUsd: false, maxAge: 7_200n }), symbol: "wMXN" };
    // MXN / USD 0.05405405 (18.5 pesos to the dollar), so 300 USDT at 0.99913512 are ~5,545.2 pesos.
    const mxnUsd = { answer: 5_405_405n, decimals: 8, updatedAt: NOW - 100n };
    const references: References = { currencyUsd: mxnUsd, dollarUsd: REFERENCES.dollarUsd };
    const quote: ConversionQuote = {
      dollarAmount: 300n * USDT_UNIT,
      quotedCurrency: 5_545n * WARS_UNIT,
      twapCurrency: 5_545n * WARS_UNIT,
      poolCurrency: 1_000_000n * WARS_UNIT,
    };

    it("reads a reference quoted in dollars per unit", () => {
      const decision = decide({ quote, references, currency: dollarsPerUnit });
      expect(decision).toEqual({ kind: "convert", dollarAmount: 300n * USDT_UNIT, minCurrencyOut: (quote.quotedCurrency * 9_950n) / 10_000n });
      // Read the other way round (as pesos per dollar), the same pool price would be far off.
      expect(decide({ quote, references, currency: withReference(dollarsPerUnit, { perUsd: true }) })).toMatchObject({ kind: "skip", code: "price-gap" });
    });

    it("names the feed the way the currency quotes it", () => {
      const broken = { ...references, currencyUsd: { ...mxnUsd, answer: 0n } };
      expect(decide({ quote, references: broken, currency: dollarsPerUnit })).toEqual({
        kind: "skip",
        code: "price-reference",
        reason: "Chainlink's MXN / USD has no valid price",
      });
    });

    it("scales by the table's decimals, not by a fixed 10^12", () => {
      // The same conversion in a currency of 6 decimals: the pool's price and Chainlink's still agree.
      const sixDecimals: Currency = { ...WARS_CURRENCY, decimals: 6 };
      const inSix = { ...QUOTE, quotedCurrency: 482_243_292_884n, twapCurrency: 482_243_292_884n, poolCurrency: 106_669_036_955_606n };
      expect(decide({ quote: inSix, currency: sixDecimals })).toMatchObject({ kind: "convert", dollarAmount: 300n * USDT_UNIT });
    });

    it("waits on a reference older than its currency's maxAge", () => {
      const fast = withReference(WARS_CURRENCY, { maxAge: 600n });
      const olderBy = (age: bigint, dollarAge = 174n) =>
        decide({
          currency: fast,
          references: {
            currencyUsd: { ...REFERENCES.currencyUsd, updatedAt: NOW - age },
            dollarUsd: { ...REFERENCES.dollarUsd, updatedAt: NOW - dollarAge },
          },
        });
      expect(olderBy(600n).kind).toBe("convert");
      expect(olderBy(700n)).toEqual({ kind: "skip", code: "price-reference", reason: "Chainlink's USD / ARS is 11.7 minutes old (10 at most)" });
      // USDT / USD keeps its own 26 hours: an hour old is fine.
      expect(olderBy(100n, 3_600n).kind).toBe("convert");
    });

    it("waits when the currency has no reference to check the pool against", () => {
      expect(decide({ currency: { ...WARS_CURRENCY, reference: null } })).toEqual({
        kind: "skip",
        code: "price-reference",
        reason: "The agent has no price reference for wARS",
      });
    });
  });
});
