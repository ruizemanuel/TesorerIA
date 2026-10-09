import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { POOL, UNISWAP_V3_QUOTER, USD_ARS_FEED, USDT, USDT_USD_FEED, WARS } from "../src/chain";
import { quoteConversion, readReferences } from "../src/market";
import { FUND } from "./support/fixtures";

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
    await expect(readReferences({ base: base.client as never, celo: celo.client as never })).resolves.toEqual({
      usdArs: { answer: 160_790_320_000n, decimals: 8, updatedAt: 1_791_555_995n },
      usdtUsd: { answer: 99_913_512n, decimals: 8, updatedAt: 1_791_561_336n },
    });
  });
});

describe("quoteConversion", () => {
  it("asks the quoter for USDT in, wARS out on the 0.01% pool, and reads the fund's TWAP and the pool's depth", async () => {
    const celo = fakeChain({
      [`${UNISWAP_V3_QUOTER}.quoteExactInputSingle`]: [482_243_292_884_944_290_611_892n, 0n, 0, 104_164n],
      [`${FUND}.quoteUsdtInWars`]: 482_300_000_000_000_000_000_000n,
      [`${WARS}.balanceOf`]: 106_669_036_955_606_543_270_134_078n,
    });
    await expect(quoteConversion(celo.client as never, FUND, 300_000_000n)).resolves.toEqual({
      usdtAmount: 300_000_000n,
      quotedWars: 482_243_292_884_944_290_611_892n,
      twapWars: 482_300_000_000_000_000_000_000n,
      poolWars: 106_669_036_955_606_543_270_134_078n,
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
});
