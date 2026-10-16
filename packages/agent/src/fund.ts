import type { Address, PublicClient } from "viem";
import { erc20Abi } from "viem";
import { fundAbi, fundFactoryAbi } from "./abi";
import { USDT, WARS } from "./chain";

/** A fund's state, read from the chain at one block. */
export type FundSnapshot = {
  address: Address;
  /** The block every value was read at. */
  block: bigint;
  agent: Address;
  closed: boolean;
  /** The current members, as the contract lists them: the only addresses the agent ever pays. */
  members: readonly Address[];
  /** What each member has contributed, in wARS, in the order of `members`. */
  contributed: readonly bigint[];
  totalContributed: bigint;
  votesRequired: number;
  weeklyCap: bigint;
  startTime: bigint;
  week: bigint;
  spentThisWeek: bigint;
  warsBalance: bigint;
  usdtBalance: bigint;
};

/** The reads the agent needs from a Celo client. */
export type CeloReader = Pick<PublicClient, "getBlockNumber" | "multicall" | "readContract">;

/**
 * Reads a fund's state, every value at the same block: `blockNumber`, or else the latest one. viem keeps a block number for a few
 * seconds and doesn't refresh it when a receipt comes back at once, so the kept one could be older than a transaction this process
 * just saw land, and the snapshot and its history would miss it (a reimbursement with it: see decideExpense). An older block is
 * for the photo of a week that closed (spec, 9.4).
 */
export async function readFund(client: CeloReader, fund: Address, blockNumber?: bigint): Promise<FundSnapshot> {
  const block = blockNumber ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const at = { allowFailure: false, blockNumber: block } as const;
  const [agent, closed, members, votesRequired, weeklyCap, startTime, week, totalContributed, warsBalance, usdtBalance] =
    await client.multicall({
      ...at,
      contracts: [
        { address: fund, abi: fundAbi, functionName: "agent" },
        { address: fund, abi: fundAbi, functionName: "closed" },
        { address: fund, abi: fundAbi, functionName: "members" },
        { address: fund, abi: fundAbi, functionName: "votesRequired" },
        { address: fund, abi: fundAbi, functionName: "weeklyCap" },
        { address: fund, abi: fundAbi, functionName: "startTime" },
        { address: fund, abi: fundAbi, functionName: "currentWeek" },
        { address: fund, abi: fundAbi, functionName: "totalContributed" },
        { address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [fund] },
        { address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [fund] },
      ],
    });
  const [spentThisWeek, contributed] = await Promise.all([
    client.readContract({ address: fund, abi: fundAbi, functionName: "spentInWeek", args: [week], blockNumber: block }),
    client.multicall({
      ...at,
      contracts: members.map((member) => ({ address: fund, abi: fundAbi, functionName: "contributed", args: [member] }) as const),
    }),
  ]);
  return {
    address: fund,
    block,
    agent,
    closed,
    members,
    contributed,
    totalContributed,
    votesRequired,
    weeklyCap,
    startTime,
    week,
    spentThisWeek,
    warsBalance,
    usdtBalance,
  };
}

/** Every fund the factory has created, oldest first. */
export async function listFunds(client: CeloReader, factory: Address): Promise<Address[]> {
  const count = await client.readContract({ address: factory, abi: fundFactoryAbi, functionName: "fundCount" });
  if (count === 0n) return [];
  return client.multicall({
    allowFailure: false,
    contracts: Array.from({ length: Number(count) }, (_, i) => ({
      address: factory,
      abi: fundFactoryAbi,
      functionName: "funds",
      args: [BigInt(i)],
    }) as const),
  });
}

/** The contract's WEEK: a fund's weeks are fixed windows of 7 days from its startTime (spec, 7.2). */
export const WEEK = 604_800n;

type BlockTimes = Pick<PublicClient, "getBlock" | "getBlockNumber">;

/**
 * The first and last block of the fund's week `week` (spec, 9.4): the last is the last one with a time below
 * startTime + (week + 1) × WEEK. `from` is a block at or before the week's first one: the fund's creation. On Celo
 * there is one block a second, so a guess from the latest block is right and two reads confirm each end; when they
 * don't (the e2e's fork moves its clock ahead), it searches by bisection. Throws if the week hasn't closed yet.
 */
export async function weekBlockRange(
  client: BlockTimes,
  { startTime, week, from }: { startTime: bigint; week: bigint; from: bigint },
): Promise<{ first: bigint; last: bigint }> {
  const latest = await client.getBlock({ blockNumber: await client.getBlockNumber({ cacheTime: 0 }) });
  const ends = startTime + (week + 1n) * WEEK;
  if (latest.timestamp < ends) throw new Error(`Week ${week} hasn't closed yet`);
  const timeOf = async (block: bigint) => (await client.getBlock({ blockNumber: block })).timestamp;
  const tip = { number: latest.number, timestamp: latest.timestamp };
  const last = await lastBlockBefore(timeOf, ends, from, tip);
  const first = (await lastBlockBefore(timeOf, startTime + week * WEEK, from, tip)) + 1n;
  return { first, last };
}

/** The last block from `from` on with a time below `time`, or `from − 1` if there's none. `latest` is at or past `time`. */
async function lastBlockBefore(
  timeOf: (block: bigint) => Promise<bigint>,
  time: bigint,
  from: bigint,
  latest: { number: bigint; timestamp: bigint },
): Promise<bigint> {
  const guess = latest.number - (latest.timestamp - (time - 1n));
  if (guess >= from && guess < latest.number && (await timeOf(guess)) < time && (await timeOf(guess + 1n)) >= time) return guess;
  // Bisection: the time of `low` is below `time` (or `low` is `from − 1`), and the time of `high` isn't.
  let low = from - 1n;
  let high = latest.number;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if ((await timeOf(middle)) < time) low = middle;
    else high = middle;
  }
  return low;
}
