import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { type CeloReader, WEEK, readFund, weekBlockRange } from "../src/fund";

const FUND = getAddress("0x00000000000000000000000000000000000f00d5");
const MEMBER = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");

describe("readFund", () => {
  it("reads every value at the chain's latest block, never at a block number viem kept from an earlier call", async () => {
    const getBlockNumber = vi.fn(async (_?: { cacheTime?: number }) => 100n);
    const multicall = vi.fn(async ({ contracts }: { contracts: unknown[] }) =>
      contracts.length === 10 ? [MEMBER, false, [MEMBER], 2, 1n, 0n, 0n, 0n, 0n, 0n] : [0n],
    );
    const readContract = vi.fn(async () => 0n);
    const client = { getBlockNumber, multicall, readContract } as unknown as CeloReader;

    const snapshot = await readFund(client, FUND);

    // A receipt that came back before the block number was polled again would leave the cached one behind it.
    expect(getBlockNumber).toHaveBeenCalledWith({ cacheTime: 0 });
    expect(snapshot.block).toBe(100n);
    for (const [call] of multicall.mock.calls) expect(call).toMatchObject({ blockNumber: 100n });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 100n }));
  });

  it("reads every value at the block it's given, without asking for the latest one", async () => {
    const getBlockNumber = vi.fn(async (_?: { cacheTime?: number }) => 100n);
    const multicall = vi.fn(async ({ contracts }: { contracts: unknown[] }) =>
      contracts.length === 10 ? [MEMBER, false, [MEMBER], 2, 1n, 0n, 0n, 0n, 0n, 0n] : [0n],
    );
    const readContract = vi.fn(async () => 0n);
    const client = { getBlockNumber, multicall, readContract } as unknown as CeloReader;

    const snapshot = await readFund(client, FUND, 42n);

    expect(getBlockNumber).not.toHaveBeenCalled();
    expect(snapshot.block).toBe(42n);
    for (const [call] of multicall.mock.calls) expect(call).toMatchObject({ blockNumber: 42n });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 42n }));
  });
});

/** The real fund was created in a block near this one, at its startTime: 2026-10-12 00:19:48 UTC. */
const CREATED = 79_700_000n;
const START = 1_791_764_388n;

/** A chain whose block `b` was made at `timeOf(b)`, up to `latest`; it keeps the blocks it was asked for. */
function chain(timeOf: (block: bigint) => bigint, latest: bigint) {
  const read: bigint[] = [];
  const client = {
    getBlockNumber: async () => latest,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      if (blockNumber > latest) throw new Error(`Block ${blockNumber} doesn't exist yet`);
      read.push(blockNumber);
      return { number: blockNumber, timestamp: timeOf(blockNumber) };
    },
  } as unknown as Parameters<typeof weekBlockRange>[0];
  return { client, read };
}

/** Celo since it's an L2: one block a second. */
const oneASecond = (block: bigint) => START + (block - CREATED);

describe("weekBlockRange: where a fund's week starts and ends on the chain (spec, 9.4)", () => {
  it("finds a week's first and last block with one block a second, as on Celo, in five reads", async () => {
    const { client, read } = chain(oneASecond, CREATED + 2n * WEEK + 100n);
    expect(await weekBlockRange(client, { startTime: START, week: 1n, from: CREATED })).toEqual({
      first: CREATED + WEEK,
      last: CREATED + 2n * WEEK - 1n,
    });
    expect(read).toHaveLength(5); // the latest, and two around each end
  });

  it("starts week 0 at the block the fund was created in", async () => {
    const { client } = chain(oneASecond, CREATED + WEEK + 10n);
    expect(await weekBlockRange(client, { startTime: START, week: 0n, from: CREATED })).toEqual({ first: CREATED, last: CREATED + WEEK - 1n });
  });

  it("finds them by bisection when the clock jumped, as on the e2e's fork", async () => {
    // An hour of blocks, then the clock moves a week ahead (anvil's evm_increaseTime): week 0 ends at the jump.
    const JUMP = CREATED + 3_600n;
    const jumped = (block: bigint) => (block < JUMP ? oneASecond(block) : oneASecond(block) + WEEK);
    const { client } = chain(jumped, JUMP + 60n);
    expect(await weekBlockRange(client, { startTime: START, week: 0n, from: CREATED })).toEqual({ first: CREATED, last: JUMP - 1n });
  });

  it("refuses a week that hasn't closed yet", async () => {
    const { client } = chain(oneASecond, CREATED + WEEK - 1n);
    await expect(weekBlockRange(client, { startTime: START, week: 0n, from: CREATED })).rejects.toThrow("Week 0 hasn't closed yet");
  });
});
