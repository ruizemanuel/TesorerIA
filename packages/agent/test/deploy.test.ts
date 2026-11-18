import {
  type Abi,
  type Address,
  decodeAbiParameters,
  decodeDeployData,
  parseAbi,
  parseAbiParameters,
  size,
  slice,
} from "viem";
import { describe, expect, it } from "vitest";
import { FEE_RECIPIENT, FUND_FACTORY, FUND_FACTORY_BLOCK, POOL, UNISWAP_V3_FACTORY, USDT, WARS } from "../src/chain";
import type { Factory } from "../src/chain";
import { CURRENCIES, MIN_POOL_HISTORY } from "../src/currencies";
import {
  type ChainReader,
  checkDollarPool,
  checkFactoryV2,
  checkFactoryV2Send,
  checkPool,
  factoryDeployData,
  factoryV2DeployData,
} from "../src/deploy";

type Read = { address: Address; functionName: string; args?: readonly unknown[] };

/** Celo as it was on 2026-10-09 (slot0 included), with one thing changed per test. Keeps every read it gets. */
function fakeCelo(
  change: { chainId?: number; officialPool?: Address; token0?: Address; observeReverts?: boolean } = {},
  reads: Read[] = [],
) {
  const reader = {
    getChainId: async () => change.chainId ?? 42220,
    readContract: async (read: Read) => {
      reads.push(read);
      const { functionName } = read;
      switch (functionName) {
        case "getPool":
          return change.officialPool ?? POOL;
        case "token0":
          return change.token0 ?? WARS;
        case "token1":
          return USDT;
        case "slot0":
          return [1975843094800887661015n, -350155, 969, 1200, 1200, 68, true];
        case "observe":
          if (change.observeReverts) throw new Error("OLD");
          return [[-981668645665n, -982298924665n], [0n, 0n]];
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
  };
  return reader as unknown as ChainReader;
}

describe("checkPool", () => {
  it("accepts the official wARS/USDT pool and returns its cardinality", async () => {
    const reads: Read[] = [];
    await expect(checkPool(fakeCelo({}, reads))).resolves.toEqual({ cardinality: 1200, cardinalityNext: 1200 });
    const getPool = reads.find((r) => r.functionName === "getPool");
    expect(getPool).toMatchObject({ address: UNISWAP_V3_FACTORY, args: [WARS, USDT, 100] });
    const observe = reads.find((r) => r.functionName === "observe");
    expect(observe).toMatchObject({ address: POOL, args: [[1800, 0]] });
  });

  it("rejects another chain", async () => {
    await expect(checkPool(fakeCelo({ chainId: 44787 }))).rejects.toThrow("Expected Celo mainnet");
  });

  it("rejects a pool that the official factory doesn't return", async () => {
    const other = "0x000000000000000000000000000000000000bEEF";
    await expect(checkPool(fakeCelo({ officialPool: other }))).rejects.toThrow("getPool");
  });

  it("rejects a pool with the tokens the other way around", async () => {
    await expect(checkPool(fakeCelo({ token0: USDT }))).rejects.toThrow("expected wARS / USDT");
  });

  it("rejects a pool that can't serve the 30-minute TWAP", async () => {
    await expect(checkPool(fakeCelo({ observeReverts: true }))).rejects.toThrow("TWAP");
  });
});

describe("factoryDeployData", () => {
  it("appends wARS, USDT and the pool as the constructor arguments", () => {
    const abi: Abi = parseAbi(["constructor(address wars_, address usdt_, address pool_)"]);
    const data = factoryDeployData({ abi, bytecode: { object: "0x6080604052" } });
    expect(slice(data, 0, 5)).toBe("0x6080604052");
    expect(size(data)).toBe(5 + 3 * 32);
    const args = decodeAbiParameters(parseAbiParameters("address, address, address"), slice(data, 5));
    expect(args).toEqual([WARS, USDT, POOL]);
  });
});

const NOW = 1_800_000_000n;
function currency(symbol: string) {
  const found = CURRENCIES.find((c) => c.symbol === symbol);
  if (!found) throw new Error(`No ${symbol} in the table`);
  return found;
}
/** wARS is the only currency with a dollar entry. */
const wars = currency("wARS");

/**
 * Celo's wARS/USDT pool as it was on 2026-10-09 (slot0: observation index 969 of 1200), the latest block at `NOW`,
 * and one thing changed per test. Keeps every read it gets.
 */
function fakeDollarCelo(
  change: {
    chainId?: number;
    officialPool?: Address;
    token0?: Address;
    token1?: Address;
    observeReverts?: boolean;
    /** How old the oldest observation is: 7 days unless said otherwise. */
    oldestAge?: bigint;
    /** The observation after the latest one has never been written (the ring is not full yet). */
    nextUninitialized?: boolean;
  } = {},
  reads: Read[] = [],
) {
  const reader = {
    getChainId: async () => change.chainId ?? 42220,
    getBlock: async () => ({ timestamp: NOW }),
    readContract: async (read: Read) => {
      reads.push(read);
      const { functionName } = read;
      switch (functionName) {
        case "getPool":
          return change.officialPool ?? POOL;
        case "token0":
          return change.token0 ?? WARS;
        case "token1":
          return change.token1 ?? USDT;
        case "slot0":
          return [1975843094800887661015n, -350155, 969, 1200, 1200, 68, true];
        case "observe":
          if (change.observeReverts) throw new Error("OLD");
          return [[-981668645665n, -982298924665n], [0n, 0n]];
        case "observations":
          if (change.nextUninitialized && read.args?.[0] === 970n) return [0, 0n, 0n, false];
          return [Number(NOW - (change.oldestAge ?? 604_800n)), -981668645665n, 1n, true];
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
  };
  return reader as unknown as Parameters<typeof checkDollarPool>[0];
}

describe("checkDollarPool", () => {
  it("accepts wARS's pool, with its history", async () => {
    const reads: Read[] = [];
    await expect(checkDollarPool(fakeDollarCelo({}, reads), wars)).resolves.toEqual({
      cardinality: 1200,
      oldestAge: 604_800n,
    });
    expect(reads.find((r) => r.functionName === "getPool")).toMatchObject({
      address: UNISWAP_V3_FACTORY,
      args: [WARS, USDT, 100],
    });
    expect(reads.find((r) => r.functionName === "observe")).toMatchObject({ address: POOL, args: [[1800, 0]] });
    // (969 + 1) % 1200: the observation after the latest one is the oldest.
    expect(reads.find((r) => r.functionName === "observations")).toMatchObject({ address: POOL, args: [970n] });
  });

  it("takes observation 0 as the oldest when the next one was never written", async () => {
    const reads: Read[] = [];
    await expect(checkDollarPool(fakeDollarCelo({ nextUninitialized: true }, reads), wars)).resolves.toEqual({
      cardinality: 1200,
      oldestAge: 604_800n,
    });
    expect(reads.filter((r) => r.functionName === "observations").map((r) => r.args)).toEqual([[970n], [0n]]);
  });

  it("accepts the pair in either order", async () => {
    await expect(checkDollarPool(fakeDollarCelo({ token0: USDT, token1: WARS }), wars)).resolves.toMatchObject({
      cardinality: 1200,
    });
  });

  it("refuses a pool whose oldest observation is younger than 6 hours", async () => {
    await expect(checkDollarPool(fakeDollarCelo({ oldestAge: MIN_POOL_HISTORY - 1n }), wars)).rejects.toThrow(
      "oldest observation",
    );
    await expect(checkDollarPool(fakeDollarCelo({ oldestAge: MIN_POOL_HISTORY }), wars)).resolves.toMatchObject({
      oldestAge: MIN_POOL_HISTORY,
    });
  });

  it("refuses another pool than Uniswap's", async () => {
    const other = "0x000000000000000000000000000000000000bEEF";
    await expect(checkDollarPool(fakeDollarCelo({ officialPool: other }), wars)).rejects.toThrow("getPool");
  });

  it("refuses a pool of other tokens", async () => {
    await expect(checkDollarPool(fakeDollarCelo({ token1: WARS }), wars)).rejects.toThrow("The pool's tokens");
  });

  it("refuses a pool that can't serve the 30-minute TWAP", async () => {
    await expect(checkDollarPool(fakeDollarCelo({ observeReverts: true }), wars)).rejects.toThrow("TWAP");
  });

  it("refuses another chain", async () => {
    await expect(checkDollarPool(fakeDollarCelo({ chainId: 44787 }), wars)).rejects.toThrow("Expected Celo mainnet");
  });

  it("refuses a currency without a dollar", async () => {
    await expect(checkDollarPool(fakeDollarCelo(), currency("wMXN"))).rejects.toThrow("wMXN has no dollar");
  });
});

describe("factoryV2DeployData", () => {
  it("passes Uniswap's factory and the fee recipient", () => {
    const abi: Abi = parseAbi(["constructor(address uniswapFactory_, address feeRecipient_)"]);
    const bytecode = "0x6080604052";
    const data = factoryV2DeployData({ abi, bytecode: { object: bytecode } });
    expect(slice(data, 0, 5)).toBe(bytecode);
    expect(size(data)).toBe(5 + 2 * 32);
    expect(decodeDeployData({ abi, bytecode, data }).args).toEqual([UNISWAP_V3_FACTORY, FEE_RECIPIENT]);
  });
});

describe("checkFactoryV2Send", () => {
  const v1: Factory = { address: FUND_FACTORY, block: FUND_FACTORY_BLOCK, version: 1 };
  const v2: Factory = { address: "0x000000000000000000000000000000000000bEEF", block: 90_000_000n, version: 2 };
  const ok = { expectNonce: 7, pendingNonce: 7, latestNonce: 7, factories: [v1], again: false };

  it("lets the deploy go when the agent's nonce is the one expected and nothing is in flight", () => {
    expect(() => checkFactoryV2Send(ok)).not.toThrow();
  });

  it("refuses without --expect-nonce", () => {
    expect(() => checkFactoryV2Send({ ...ok, expectNonce: undefined })).toThrow("--expect-nonce");
  });

  it("refuses when the pending nonce is not the one expected", () => {
    expect(() => checkFactoryV2Send({ ...ok, expectNonce: 6 })).toThrow("pending nonce is 7, not the 6");
  });

  it("refuses when the agent has a transaction in flight", () => {
    expect(() => checkFactoryV2Send({ ...ok, pendingNonce: 8, expectNonce: 8, latestNonce: 7 })).toThrow("in flight");
  });

  it("refuses a second FundFactoryV2, unless --again", () => {
    expect(() => checkFactoryV2Send({ ...ok, factories: [v1, v2] })).toThrow("already lists a FundFactoryV2");
    expect(() => checkFactoryV2Send({ ...ok, factories: [v1, v2], again: true })).not.toThrow();
  });

  it("keeps refusing a wrong nonce with --again", () => {
    expect(() => checkFactoryV2Send({ ...ok, factories: [v1, v2], again: true, expectNonce: 6 })).toThrow(
      "pending nonce",
    );
  });
});

describe("checkFactoryV2", () => {
  const deployed: Address = "0x000000000000000000000000000000000000dEaD";
  const other: Address = "0x000000000000000000000000000000000000bEEF";

  function fakeFactory(
    values: { uniswapFactory?: Address; feeRecipient?: Address; fundCount?: bigint } = {},
    reads: Read[] = [],
  ) {
    const reader = {
      readContract: async (read: Read) => {
        reads.push(read);
        switch (read.functionName) {
          case "uniswapFactory":
            return values.uniswapFactory ?? UNISWAP_V3_FACTORY;
          case "feeRecipient":
            return values.feeRecipient ?? FEE_RECIPIENT;
          case "fundCount":
            return values.fundCount ?? 0n;
          default:
            throw new Error(`unexpected read ${read.functionName}`);
        }
      },
    };
    return reader as unknown as Parameters<typeof checkFactoryV2>[0];
  }

  it("accepts a factory with Uniswap's factory, the fee recipient and no funds", async () => {
    const reads: Read[] = [];
    await expect(checkFactoryV2(fakeFactory({}, reads), deployed)).resolves.toBeUndefined();
    expect(reads.map((r) => [r.address, r.functionName])).toEqual([
      [deployed, "uniswapFactory"],
      [deployed, "feeRecipient"],
      [deployed, "fundCount"],
    ]);
  });

  it("refuses another Uniswap factory, another fee recipient and a factory with funds", async () => {
    await expect(checkFactoryV2(fakeFactory({ uniswapFactory: other }), deployed)).rejects.toThrow("uniswapFactory");
    await expect(checkFactoryV2(fakeFactory({ feeRecipient: other }), deployed)).rejects.toThrow("feeRecipient");
    await expect(checkFactoryV2(fakeFactory({ fundCount: 1n }), deployed)).rejects.toThrow("fundCount");
  });
});
