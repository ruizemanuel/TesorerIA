import { type Abi, type Address, decodeAbiParameters, parseAbi, parseAbiParameters, size, slice } from "viem";
import { describe, expect, it } from "vitest";
import { POOL, UNISWAP_V3_FACTORY, USDT, WARS } from "../src/chain";
import { type ChainReader, checkPool, factoryDeployData } from "../src/deploy";

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
