import { type Address, getAddress, zeroAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { FACTORIES, FUND_FACTORY, FUND_FACTORY_V2, POOL, USDT, WARS } from "../src/chain";
import { CURRENCIES } from "../src/currencies";
import { type CeloReader, type FundRef, WEEK, listFunds, readFund, weekBlockRange, weekStartBlock } from "../src/fund";
import { BLOCK, fundSnapshotV2 } from "./support/fixtures";

const FUND = getAddress("0x00000000000000000000000000000000000f00d5");
const MEMBER = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const OTHER = getAddress("0x000000000000000000000000000000000000aaa2");
const AGENT = getAddress("0x00000000000000000000000000000000000a6e17");
const FUND_START = 1_791_000_000n;
/** A block's time: a few hours into the fund's week 2. */
const TIMESTAMP = FUND_START + 2n * WEEK + 3_600n;
const WMXN = CURRENCIES.find((currency) => currency.symbol === "wMXN")?.token as Address;
const V1: FundRef = { address: FUND, version: 1 };
const V2: FundRef = { address: FUND, version: 2 };

type Call = { address: Address; functionName: string; args?: readonly unknown[]; blockNumber?: bigint };

/**
 * A client whose contracts answer by function name, and that keeps every call it was asked, whether as a multicall's
 * entry or a readContract. `answer` throws for what the fund shouldn't be asked.
 */
function fakeClient(answer: (call: Call) => unknown, { block = 100n }: { block?: bigint } = {}) {
  const calls: Call[] = [];
  const read = (call: Call) => {
    calls.push(call);
    return answer(call);
  };
  const getBlockNumber = vi.fn(async (_?: { cacheTime?: number }) => block);
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, timestamp: TIMESTAMP }));
  const multicall = vi.fn(async ({ contracts, blockNumber }: { contracts: Call[]; blockNumber?: bigint }) =>
    contracts.map((call) => read({ ...call, blockNumber })),
  );
  const readContract = vi.fn(async (call: Call) => read(call));
  return {
    client: { getBlockNumber, getBlock, multicall, readContract } as unknown as CeloReader,
    calls,
    getBlockNumber,
    getBlock,
    multicall,
    readContract,
  };
}

const names = (calls: Call[]) => calls.map((call) => call.functionName);

/** What a version 1 fund of two answers: wARS and USDT are its currency and its dollar, and it holds some of each. */
function version1(call: Call): unknown {
  switch (call.functionName) {
    case "agent":
      return AGENT;
    case "closed":
      return false;
    case "members":
      return [MEMBER, OTHER];
    case "votesRequired":
      return 2;
    case "weeklyCap":
      return 60_000n * 10n ** 18n;
    case "startTime":
      return FUND_START;
    case "currentWeek":
      return 2n;
    case "totalContributed":
      return 50_000n * 10n ** 18n;
    case "balanceCap":
      return 450_000n * 10n ** 18n;
    case "spentInWeek":
      return 7_000n * 10n ** 18n;
    case "proposalCount":
      return 3n;
    case "contributed":
      return call.args?.[0] === MEMBER ? 30_000n * 10n ** 18n : 20_000n * 10n ** 18n;
    case "balanceOf":
      if (call.address === WARS) return 43_000n * 10n ** 18n;
      if (call.address === USDT) return 12_500_000n;
      throw new Error(`balanceOf of ${call.address}`);
    default:
      throw new Error(`a version 1 fund was asked for ${call.functionName}`);
  }
}

const PENDING = new Map<Address, bigint>([
  [MEMBER, 40_000_000n],
  [OTHER, 0n],
]);

/** What a version 2 fund of two answers, with the currency, dollar and pool given (zero for no dollar and no pool). */
function version2({ currency, dollar, pool }: { currency: Address; dollar: Address; pool: Address }) {
  return (call: Call): unknown => {
    // A fund with no dollar has no pool to read, and the fake says so for any address it was never given.
    if (pool === zeroAddress && (call.address === POOL || call.address === zeroAddress)) {
      throw new Error(`the pool, or the zero address, was asked for ${call.functionName}`);
    }
    switch (call.functionName) {
      case "currency":
        return currency;
      case "dollar":
        return dollar;
      case "pool":
        return pool;
      case "feeBps":
        return 25;
      case "feeOwed":
        return 125n * 10n ** 18n;
      case "availableCurrency":
        return 42_875n * 10n ** 18n;
      case "totalPendingDollar":
        return dollar === zeroAddress ? 0n : 40_000_000n;
      case "pendingDollar":
        return dollar === zeroAddress ? 0n : PENDING.get(call.args?.[0] as Address);
      case "quoteDollar":
        // The contract reverts with NoDollar, even for 0.
        if (dollar === zeroAddress) throw new Error("NoDollar");
        return (call.args?.[0] as bigint) * 1_600n * 10n ** 12n;
      case "proposalsInWeek":
        return call.args?.[0] === 2n && call.args?.[1] === AGENT ? 4n : 99n;
      case "balanceOf":
        // The dollar the fund holds, pending or sent straight to it; of a fund with no dollar, nobody asks.
        if (dollar !== zeroAddress && call.address === dollar) return 55_000_000n;
        throw new Error(`balanceOf of ${call.address}`);
      default:
        return version1(call);
    }
  };
}

describe("readFund", () => {
  it("reads every value at the chain's latest block, never at a block number viem kept from an earlier call", async () => {
    const { client, getBlockNumber, multicall, readContract } = fakeClient(version1);

    const snapshot = await readFund(client, V1);

    // A receipt that came back before the block number was polled again would leave the cached one behind it.
    expect(getBlockNumber).toHaveBeenCalledWith({ cacheTime: 0 });
    expect(snapshot.block).toBe(100n);
    for (const [call] of multicall.mock.calls) expect(call).toMatchObject({ blockNumber: 100n });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 100n }));
  });

  it("reads every value at the block it's given, without asking for the latest one", async () => {
    const { client, getBlockNumber, getBlock, multicall, readContract } = fakeClient(version1);

    const snapshot = await readFund(client, V1, 42n);

    expect(getBlockNumber).not.toHaveBeenCalled();
    expect(snapshot.block).toBe(42n);
    for (const [call] of multicall.mock.calls) expect(call).toMatchObject({ blockNumber: 42n });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 42n }));
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 42n });
  });

  it("reads how many proposals the fund has, at the same block, so a history can be checked against it", async () => {
    const { client, readContract } = fakeClient(version1);

    const snapshot = await readFund(client, V1, 42n);

    expect(snapshot.proposalCount).toBe(3n);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "proposalCount", blockNumber: 42n }));
  });

  it("takes the time of the block it read, never the server's clock", async () => {
    const { client, getBlock } = fakeClient(version1);

    const snapshot = await readFund(client, V1, 42n);

    expect(snapshot.timestamp).toBe(TIMESTAMP);
    expect(getBlock).toHaveBeenCalledTimes(1);
  });

  it("reads a v1 fund with wARS, USDT and no fee", async () => {
    const { client, calls } = fakeClient(version1);

    expect(await readFund(client, V1)).toEqual({
      address: FUND,
      version: 1,
      block: 100n,
      timestamp: TIMESTAMP,
      agent: AGENT,
      closed: false,
      members: [MEMBER, OTHER],
      contributed: [30_000n * 10n ** 18n, 20_000n * 10n ** 18n],
      totalContributed: 50_000n * 10n ** 18n,
      proposalCount: 3n,
      votesRequired: 2,
      weeklyCap: 60_000n * 10n ** 18n,
      startTime: FUND_START,
      week: 2n,
      spentThisWeek: 7_000n * 10n ** 18n,
      currency: WARS,
      dollar: USDT,
      pool: POOL,
      feeBps: 0,
      feeOwed: 0n,
      balanceCap: 450_000n * 10n ** 18n,
      currencyBalance: 43_000n * 10n ** 18n,
      dollarBalance: 12_500_000n,
      pendingDollar: [0n, 0n],
      pendingValue: [0n, 0n],
      totalPendingDollar: 0n,
      agentProposalsThisWeek: 0n,
    });
    // `version1` throws for any function the contract doesn't have: these were never asked.
    expect(names(calls)).not.toContain("quoteDollar");
    expect(names(calls)).not.toContain("proposalsInWeek");
  });

  it("reads a v2 fund with a dollar: each member's pending dollars and their TWAP value", async () => {
    const { client, calls } = fakeClient(version2({ currency: WARS, dollar: USDT, pool: POOL }));

    const snapshot = await readFund(client, V2);

    expect(snapshot).toMatchObject({
      address: FUND,
      version: 2,
      block: 100n,
      timestamp: TIMESTAMP,
      members: [MEMBER, OTHER],
      currency: WARS,
      dollar: USDT,
      pool: POOL,
      feeBps: 25,
      feeOwed: 125n * 10n ** 18n,
      balanceCap: 450_000n * 10n ** 18n,
      // What the fund can pay, not what the token says it holds; the dollar is all of it, pending or not.
      currencyBalance: 42_875n * 10n ** 18n,
      dollarBalance: 55_000_000n,
      pendingDollar: [40_000_000n, 0n],
      pendingValue: [64_000n * 10n ** 18n, 0n],
      totalPendingDollar: 40_000_000n,
      contributed: [30_000n * 10n ** 18n, 20_000n * 10n ** 18n],
      proposalCount: 3n,
    });
    // The agent's proposals of the fund's current week.
    expect(snapshot.agentProposalsThisWeek).toBe(4n);
    expect(calls).toContainEqual(expect.objectContaining({ address: FUND, functionName: "quoteDollar", args: [40_000_000n] }));
    expect(calls).toContainEqual(expect.objectContaining({ address: USDT, functionName: "balanceOf", args: [FUND] }));
    // Every call at the block the snapshot says.
    for (const call of calls) expect(call.blockNumber).toBe(100n);
  });

  it("reads a v2 fund without a dollar and never calls quoteDollar", async () => {
    // quoteDollar reverts with NoDollar even for 0: asking would break the screen of a wMXN fund. The fake throws for it,
    // for the dollar's balanceOf, and for anything of a pool.
    const { client, calls } = fakeClient(version2({ currency: WMXN, dollar: zeroAddress, pool: zeroAddress }));

    const snapshot = await readFund(client, V2);

    expect(snapshot).toMatchObject({
      version: 2,
      currency: WMXN,
      dollar: null,
      pool: null,
      currencyBalance: 42_875n * 10n ** 18n,
      dollarBalance: 0n,
      pendingDollar: [0n, 0n],
      pendingValue: [0n, 0n],
      totalPendingDollar: 0n,
    });
    expect(names(calls)).not.toContain("quoteDollar");
    expect(names(calls)).not.toContain("balanceOf");
    expect(calls.filter((call) => call.address === zeroAddress || call.address === POOL)).toEqual([]);
  });
});

describe("listFunds", () => {
  const A = getAddress("0x00000000000000000000000000000000000000a1");
  const B = getAddress("0x00000000000000000000000000000000000000b2");
  const C = getAddress("0x00000000000000000000000000000000000000c3");
  const reader = (created: Map<Address, Address[]>) =>
    ({
      readContract: async ({ address }: Call) => BigInt(created.get(address)?.length ?? 0),
      multicall: async ({ contracts }: { contracts: Call[] }) =>
        contracts.map(({ address, args }) => created.get(address)?.[Number(args?.[0])]),
    }) as unknown as CeloReader;

  it("lists every factory's funds, each with its version, oldest factory first", async () => {
    const client = reader(
      new Map([
        [FUND_FACTORY, [A, B]],
        [FUND_FACTORY_V2, [C]],
      ]),
    );
    const expected: FundRef[] = [
      { address: A, version: 1 },
      { address: B, version: 1 },
      { address: C, version: 2 },
    ];
    expect(await listFunds(client)).toEqual(expected);
    // The oldest factory leads whatever the order it was handed in.
    expect(await listFunds(client, [...FACTORIES].reverse())).toEqual(expected);
  });

  it("goes on past a factory that has created nothing yet", async () => {
    const client = reader(new Map([[FUND_FACTORY, [A, B]]]));
    expect(await listFunds(client)).toEqual([
      { address: A, version: 1 },
      { address: B, version: 1 },
    ]);
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

describe("weekStartBlock", () => {
  it("places the week's first block by the block's own time", () => {
    // The fixture fund is in week 2, an hour into it: with a block a second, its week began 3,600 blocks ago.
    const fund = fundSnapshotV2();
    expect(fund.timestamp - (fund.startTime + fund.week * WEEK)).toBe(3_600n);
    expect(weekStartBlock(fund)).toBe(BLOCK - 3_600n);
    // A block made at the week's first second is the week's first block.
    expect(weekStartBlock({ ...fund, timestamp: fund.startTime + fund.week * WEEK })).toBe(BLOCK);
    // It goes by the block's time, never the server's clock: a chain far ahead of it (the fork, the e2e) puts the week where its own time says.
    const ahead = { ...fund, week: 40n, timestamp: fund.startTime + 40n * WEEK + 60n };
    expect(weekStartBlock(ahead)).toBe(BLOCK - 60n);
  });

  it("is never before block 0", () => {
    expect(weekStartBlock({ ...fundSnapshotV2(), block: 100n })).toBe(0n);
  });
});
