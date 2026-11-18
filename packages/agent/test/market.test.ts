import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { POOL, UNISWAP_V3_QUOTER, USD_ARS_FEED, USDT, USDT_USD_FEED, WARS } from "../src/chain";
import { CURRENCIES, type Currency } from "../src/currencies";
import { quoteConversion, readReferences } from "../src/market";
import { FUND, OUTSIDER, fundSnapshot, fundSnapshotV2, fundSnapshotWithoutDollar } from "./support/fixtures";

type Call = { address: Address; functionName: string; args?: readonly unknown[] };

/** A chain that answers each read from a table keyed by address and function, and keeps every call. */
function fakeChain(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const answer = async (call: Call) => {
    calls.push(call);
    const key = `${call.address}.${call.functionName}`;
    if (!(key in answers)) throw new Error(`unexpected read ${key}`);
    return answers[key];
  };
  return {
    calls,
    client: { readContract: answer, simulateContract: async (call: Call) => ({ result: await answer(call) }) },
  };
}

const currency = (symbol: Currency["symbol"]) => CURRENCIES.find((c) => c.symbol === symbol) as Currency;

describe("readReferences", () => {
  it("reads USD / ARS from Base and USDT / USD from Celo, as of 2026-10-09", async () => {
    const base = fakeChain({
      [`${USD_ARS_FEED}.decimals`]: 8,
      [`${USD_ARS_FEED}.latestRoundData`]: [1n, 160_790_320_000n, 1_791_555_980n, 1_791_555_995n, 1n],
    });
    const celo = fakeChain({
      [`${USDT_USD_FEED}.decimals`]: 8,
      [`${USDT_USD_FEED}.latestRoundData`]: [1n, 99_913_512n, 1_791_561_336n, 1_791_561_336n, 1n],
    });
    await expect(readReferences({ base: base.client as never, celo: celo.client as never }, currency("wARS"))).resolves.toEqual({
      currencyUsd: { answer: 160_790_320_000n, decimals: 8, updatedAt: 1_791_555_995n },
      dollarUsd: { answer: 99_913_512n, decimals: 8, updatedAt: 1_791_561_336n },
    });
  });

  it("reads the currency's feed on its chain and USDT/USD on Celo", async () => {
    // wBRL's feed is on Celo, so Base isn't read at all.
    const brlFeed = (currency("wBRL").reference as NonNullable<Currency["reference"]>).feed;
    const base = fakeChain({});
    const celo = fakeChain({
      [`${brlFeed}.decimals`]: 8,
      [`${brlFeed}.latestRoundData`]: [1n, 18_500_000n, 1_791_561_000n, 1_791_561_100n, 1n],
      [`${USDT_USD_FEED}.decimals`]: 8,
      [`${USDT_USD_FEED}.latestRoundData`]: [1n, 99_913_512n, 1_791_561_336n, 1_791_561_336n, 1n],
    });
    await expect(readReferences({ base: base.client as never, celo: celo.client as never }, currency("wBRL"))).resolves.toEqual({
      currencyUsd: { answer: 18_500_000n, decimals: 8, updatedAt: 1_791_561_100n },
      dollarUsd: { answer: 99_913_512n, decimals: 8, updatedAt: 1_791_561_336n },
    });
    expect(base.calls).toEqual([]);
    expect(celo.calls.map((c) => c.address)).toEqual(expect.arrayContaining([brlFeed, USDT_USD_FEED]));
  });

  it("has nothing to read for a currency without a reference", async () => {
    const none = fakeChain({});
    await expect(readReferences({ base: none.client as never, celo: none.client as never }, currency("wPEN"))).rejects.toThrow(
      "no price reference for wPEN",
    );
    expect(none.calls).toEqual([]);
  });
});

describe("quoteConversion", () => {
  it("asks the quoter for USDT in, wARS out on the 0.01% pool, and reads the fund's TWAP and the pool's depth", async () => {
    const celo = fakeChain({
      [`${UNISWAP_V3_QUOTER}.quoteExactInputSingle`]: [482_243_292_884_944_290_611_892n, 0n, 0, 104_164n],
      [`${FUND}.quoteUsdtInWars`]: 482_300_000_000_000_000_000_000n,
      [`${WARS}.balanceOf`]: 106_669_036_955_606_543_270_134_078n,
    });
    await expect(quoteConversion(celo.client as never, fundSnapshot(), 300_000_000n)).resolves.toEqual({
      dollarAmount: 300_000_000n,
      quotedCurrency: 482_243_292_884_944_290_611_892n,
      twapCurrency: 482_300_000_000_000_000_000_000n,
      poolCurrency: 106_669_036_955_606_543_270_134_078n,
    });
    expect(celo.calls).toContainEqual(
      expect.objectContaining({
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: USDT, tokenOut: WARS, amountIn: 300_000_000n, fee: 100, sqrtPriceLimitX96: 0n }],
      }),
    );
    expect(celo.calls).toContainEqual(expect.objectContaining({ functionName: "quoteUsdtInWars", args: [300_000_000n] }));
    expect(celo.calls).toContainEqual(expect.objectContaining({ address: WARS, functionName: "balanceOf", args: [POOL] }));
  });

  it("quotes a v2 fund through quoteDollar and its pool", async () => {
    // The pool is the fund's own, not a constant: a stand-in address shows where the depth is read.
    const fund = fundSnapshotV2({ pool: OUTSIDER });
    const celo = fakeChain({
      [`${UNISWAP_V3_QUOTER}.quoteExactInputSingle`]: [482_243_292_884_944_290_611_892n, 0n, 0, 104_164n],
      [`${FUND}.quoteDollar`]: 482_300_000_000_000_000_000_000n,
      [`${WARS}.balanceOf`]: 106_669_036_955_606_543_270_134_078n,
    });
    await expect(quoteConversion(celo.client as never, fund, 300_000_000n)).resolves.toEqual({
      dollarAmount: 300_000_000n,
      quotedCurrency: 482_243_292_884_944_290_611_892n,
      twapCurrency: 482_300_000_000_000_000_000_000n,
      poolCurrency: 106_669_036_955_606_543_270_134_078n,
    });
    expect(celo.calls).toContainEqual(
      expect.objectContaining({
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: fund.dollar, tokenOut: fund.currency, amountIn: 300_000_000n, fee: 100, sqrtPriceLimitX96: 0n }],
      }),
    );
    expect(celo.calls).toContainEqual(expect.objectContaining({ address: FUND, functionName: "quoteDollar", args: [300_000_000n] }));
    expect(celo.calls).toContainEqual(expect.objectContaining({ address: WARS, functionName: "balanceOf", args: [OUTSIDER] }));
    expect(celo.calls.map((c) => c.functionName)).not.toContain("quoteUsdtInWars");
  });

  it("has no quote for a fund without a dollar", async () => {
    const none = fakeChain({});
    await expect(quoteConversion(none.client as never, fundSnapshotWithoutDollar("wMXN"), 1n)).rejects.toThrow("no dollar");
    expect(none.calls).toEqual([]);
  });
});
