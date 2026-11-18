import type { Address, PublicClient } from "viem";
import { erc20Abi, isAddressEqual, zeroAddress } from "viem";
import { fundAbi, fundFactoryAbi, fundV2Abi } from "./abi";
import { FACTORIES, type Factory, type FundVersion, POOL, USDT, WARS } from "./chain";
import type { FundEvent } from "./events";

/** A fund and the contract it runs: where to read it from, and how. */
export type FundRef = { address: Address; version: FundVersion };

/** A fund's state, read from the chain at one block. */
export type FundSnapshot = {
  address: Address;
  version: FundVersion;
  /** The block every value was read at. */
  block: bigint;
  /** The time of `block`, in Unix seconds: what the fund's week is measured by, never the server's clock. */
  timestamp: bigint;
  agent: Address;
  closed: boolean;
  /** The current members, as the contract lists them: the only addresses the agent ever pays. */
  members: readonly Address[];
  /** What each member has contributed, in the fund's currency, in the order of `members`. */
  contributed: readonly bigint[];
  totalContributed: bigint;
  /** How many proposals were ever made: the history must have as many ProposalCreated. */
  proposalCount: bigint;
  votesRequired: number;
  weeklyCap: bigint;
  startTime: bigint;
  week: bigint;
  spentThisWeek: bigint;
  /** The token the fund keeps its money in. Version 1: wARS. */
  currency: Address;
  /** The dollar it also takes, or null if it takes none (version 2 only). Version 1: USDT. */
  dollar: Address | null;
  /** The Uniswap pool its dollar converts in, null without a dollar. Version 1: the wARS / USDT pool. */
  pool: Address | null;
  /** The fee a conversion pays, in basis points, and what the fund still owes of it. Version 1: none. */
  feeBps: number;
  feeOwed: bigint;
  balanceCap: bigint;
  /** What the fund can pay: version 1, its balance of the currency; version 2, `availableCurrency()`. */
  currencyBalance: bigint;
  /** All the dollar it holds, pending and sent directly to it; 0 without a dollar. */
  dollarBalance: bigint;
  /** Version 2, in the order of `members`: each one's pending dollars, and their gross TWAP value (`quoteDollar`). Version 1: zeros. */
  pendingDollar: readonly bigint[];
  pendingValue: readonly bigint[];
  totalPendingDollar: bigint;
  /** Version 2: how many proposals the agent made in the fund's current week (`proposalsInWeek`). Version 1: 0. */
  agentProposalsThisWeek: bigint;
};

/**
 * The reads the agent needs from a Celo client. `getBlock` is typed by what is read of it, the block's time: a client made for
 * Celo returns Celo's own block type, which `PublicClient's` generic one doesn't accept.
 */
export type CeloReader = Pick<PublicClient, "getBlockNumber" | "multicall" | "readContract"> & {
  getBlock(parameters: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

type At = { allowFailure: false; blockNumber: bigint };

/**
 * Reads a fund's state, every value at the same block: `blockNumber`, or else the latest one. viem keeps a block number for a few
 * seconds and doesn't refresh it when a receipt comes back at once, so the kept one could be older than a transaction this process
 * just saw land, and the snapshot and its history would miss it (a reimbursement with it: see decideExpense). An older block is
 * for the photo of a week that closed (spec, 9.4). `timestamp` is that block's time.
 *
 * A version 1 fund is wARS with USDT and no fee; a version 2 fund says its own currency, dollar, pool and fee. A version 2 fund
 * with no dollar never asks for the dollar's balance, for `quoteDollar` (which reverts with `NoDollar`, even for 0) or for anything
 * of a pool.
 */
export async function readFund(client: CeloReader, fund: FundRef, blockNumber?: bigint): Promise<FundSnapshot> {
  const block = blockNumber ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const at = { allowFailure: false, blockNumber: block } as const;
  const [{ timestamp }, state] = await Promise.all([
    client.getBlock({ blockNumber: block }),
    fund.version === 1 ? readVersion1(client, fund.address, at) : readVersion2(client, fund.address, at),
  ]);
  return { address: fund.address, version: fund.version, block, timestamp, ...state };
}

/**
 * What both versions have and name the same, so `fundAbi` reads either. Called once the first read says the week and the
 * members.
 */
async function readHistoryCounters(client: CeloReader, fund: Address, at: At, week: bigint, members: readonly Address[]) {
  const [spentThisWeek, proposalCount, contributed] = await Promise.all([
    client.readContract({ address: fund, abi: fundAbi, functionName: "spentInWeek", args: [week], blockNumber: at.blockNumber }),
    client.readContract({ address: fund, abi: fundAbi, functionName: "proposalCount", blockNumber: at.blockNumber }),
    client.multicall({
      ...at,
      contracts: members.map((member) => ({ address: fund, abi: fundAbi, functionName: "contributed", args: [member] }) as const),
    }),
  ]);
  return { spentThisWeek, proposalCount, contributed };
}

async function readVersion1(client: CeloReader, fund: Address, at: At) {
  const [agent, closed, members, votesRequired, weeklyCap, startTime, week, totalContributed, balanceCap, currencyBalance, dollarBalance] =
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
        { address: fund, abi: fundAbi, functionName: "balanceCap" },
        { address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [fund] },
        { address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [fund] },
      ],
    });
  const counters = await readHistoryCounters(client, fund, at, week, members);
  const zeros = members.map(() => 0n);
  return {
    agent,
    closed,
    members,
    totalContributed,
    votesRequired,
    weeklyCap,
    startTime,
    week,
    ...counters,
    currency: WARS,
    dollar: USDT,
    pool: POOL,
    feeBps: 0,
    feeOwed: 0n,
    balanceCap,
    currencyBalance,
    dollarBalance,
    pendingDollar: zeros,
    pendingValue: zeros,
    totalPendingDollar: 0n,
    agentProposalsThisWeek: 0n,
  };
}

async function readVersion2(client: CeloReader, fund: Address, at: At) {
  const [
    agent,
    closed,
    members,
    votesRequired,
    weeklyCap,
    startTime,
    week,
    totalContributed,
    balanceCap,
    currency,
    dollar,
    pool,
    feeBps,
    feeOwed,
    currencyBalance,
    totalPendingDollar,
  ] = await client.multicall({
    ...at,
    contracts: [
      { address: fund, abi: fundV2Abi, functionName: "agent" },
      { address: fund, abi: fundV2Abi, functionName: "closed" },
      { address: fund, abi: fundV2Abi, functionName: "members" },
      { address: fund, abi: fundV2Abi, functionName: "votesRequired" },
      { address: fund, abi: fundV2Abi, functionName: "weeklyCap" },
      { address: fund, abi: fundV2Abi, functionName: "startTime" },
      { address: fund, abi: fundV2Abi, functionName: "currentWeek" },
      { address: fund, abi: fundV2Abi, functionName: "totalContributed" },
      { address: fund, abi: fundV2Abi, functionName: "balanceCap" },
      { address: fund, abi: fundV2Abi, functionName: "currency" },
      { address: fund, abi: fundV2Abi, functionName: "dollar" },
      { address: fund, abi: fundV2Abi, functionName: "pool" },
      { address: fund, abi: fundV2Abi, functionName: "feeBps" },
      { address: fund, abi: fundV2Abi, functionName: "feeOwed" },
      { address: fund, abi: fundV2Abi, functionName: "availableCurrency" },
      { address: fund, abi: fundV2Abi, functionName: "totalPendingDollar" },
    ],
  });
  const dollarToken = isAddressEqual(dollar, zeroAddress) ? null : dollar;
  const [counters, pendingDollar, agentProposalsThisWeek, dollarBalance] = await Promise.all([
    readHistoryCounters(client, fund, at, week, members),
    client.multicall({
      ...at,
      contracts: members.map((member) => ({ address: fund, abi: fundV2Abi, functionName: "pendingDollar", args: [member] }) as const),
    }),
    client.readContract({ address: fund, abi: fundV2Abi, functionName: "proposalsInWeek", args: [week, agent], blockNumber: at.blockNumber }),
    dollarToken === null
      ? 0n
      : client.readContract({ address: dollarToken, abi: erc20Abi, functionName: "balanceOf", args: [fund], blockNumber: at.blockNumber }),
  ]);
  // Only a fund with a dollar can value it: quoteDollar reverts with NoDollar, even for 0.
  const pendingValue =
    dollarToken === null
      ? pendingDollar.map(() => 0n)
      : await client.multicall({
          ...at,
          contracts: pendingDollar.map((amount) => ({ address: fund, abi: fundV2Abi, functionName: "quoteDollar", args: [amount] }) as const),
        });
  return {
    agent,
    closed,
    members,
    totalContributed,
    votesRequired,
    weeklyCap,
    startTime,
    week,
    ...counters,
    currency,
    dollar: dollarToken,
    pool: isAddressEqual(pool, zeroAddress) ? null : pool,
    feeBps,
    feeOwed,
    balanceCap,
    currencyBalance,
    dollarBalance,
    pendingDollar,
    pendingValue,
    totalPendingDollar,
    agentProposalsThisWeek,
  };
}

/**
 * Every fund the factories have created, each with its version: the oldest factory's first, and each factory's in the order
 * it created them. Both factories list their funds the same way, which is why `fundFactoryAbi` reads either.
 */
export async function listFunds(client: CeloReader, factories: readonly Factory[] = FACTORIES): Promise<FundRef[]> {
  const oldestFirst = [...factories].sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
  const listed = await Promise.all(
    oldestFirst.map(async ({ address: factory, version }) => {
      const count = await client.readContract({ address: factory, abi: fundFactoryAbi, functionName: "fundCount" });
      if (count === 0n) return [];
      const created = await client.multicall({
        allowFailure: false,
        contracts: Array.from({ length: Number(count) }, (_, i) => ({
          address: factory,
          abi: fundFactoryAbi,
          functionName: "funds",
          args: [BigInt(i)],
        }) as const),
      });
      return created.map((address): FundRef => ({ address, version }));
    }),
  );
  return listed.flat();
}

/** The contract's WEEK: a fund's weeks are fixed windows of 7 days from its startTime (spec, 7.2). */
export const WEEK = 604_800n;

/** FundV2's MAX_PROPOSALS_PER_WEEK: what each proposer, the agent too, may propose in a fund's week. */
export const MAX_PROPOSALS_PER_WEEK = 10n;

/**
 * The block the fund's current week began in, at a block a second as on Celo. It goes by the snapshot's own block and the
 * time of it, never the server's clock: on the fork and in the e2e the chain runs ahead of it. A chain that skipped
 * time inside the week (those two) puts it earlier than it was, so the last blocks of the week before would count in
 * this one. Never before block 0.
 */
export function weekStartBlock(fund: FundSnapshot): bigint {
  const elapsed = fund.timestamp - (fund.startTime + fund.week * WEEK);
  return fund.block > elapsed ? fund.block - elapsed : 0n;
}

/**
 * How many of the agent's proposals this week a member may still ask for (spec, 8.1). In the app the agent proposes
 * everyone's expenses and give-backs, so its MAX_PROPOSALS_PER_WEEK are in practice the whole fund's, and the contract's
 * count is only the agent's. Every member keeps at least one: `left` is what the agent has left this week, less one for
 * each of the other members who hasn't had any yet. `used` is the agent's proposals since the week began that name
 * `member`. Version 1 has no such limit: null.
 */
export function proposalQuota(
  fund: FundSnapshot,
  events: readonly FundEvent[],
  member: Address,
): { used: number; left: number } | null {
  if (fund.version === 1) return null;
  const since = weekStartBlock(fund);
  const usedBy = new Map<string, number>();
  for (const event of events) {
    if (event.eventName !== "ProposalCreated" || event.blockNumber < since || !isAddressEqual(event.args.proposer, fund.agent)) continue;
    const named = event.args.a.toLowerCase();
    usedBy.set(named, (usedBy.get(named) ?? 0) + 1);
  }
  const used = (m: Address) => usedBy.get(m.toLowerCase()) ?? 0;
  const waiting = fund.members.filter((m) => !isAddressEqual(m, member) && used(m) === 0).length;
  const free = MAX_PROPOSALS_PER_WEEK - fund.agentProposalsThisWeek;
  const left = free > 0n ? Number(free) - waiting : 0;
  return { used: used(member), left: Math.max(0, left) };
}

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
