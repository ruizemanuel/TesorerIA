import {
  FUND_FACTORY_BLOCK,
  type LogReader,
  type WeekSummaryFacts,
  fundAbi,
  readFund,
  readFundEvents,
  shortMessage,
  weekBlockRange,
  weekSummary,
} from "@tesoreria/agent";
import { and, eq } from "drizzle-orm";
import { type Address, type PublicClient, getAddress, isAddressEqual } from "viem";
import { agentAddress } from "./agent-address";
import { celoClient, logReader } from "./chain";
import { blockTime, weekAt } from "./chain-time";
import type { Db } from "./db/client";
import { type StoredWeekSummary, funds, weekSummaries } from "./db/schema";
import { memberFundAbi } from "./fund-abi";
import { checkHistory } from "./history";

/** WeekSummaryFacts as the database keeps them (jsonb): every bigint as its decimal string. */
export function storeFacts(facts: WeekSummaryFacts): StoredWeekSummary {
  return {
    week: facts.week.toString(),
    block: facts.block.toString(),
    startsAt: facts.startsAt.toString(),
    endsAt: facts.endsAt.toString(),
    balance: facts.balance.toString(),
    dues: facts.dues.map(({ member, owed }) => ({ member, owed: owed.toString() })),
    contributed: facts.contributed.toString(),
    reimbursements: facts.reimbursements.map(({ member, amount }) => ({ member, amount: amount.toString() })),
    payments: facts.payments.map(({ member, amount, note }) => ({ member, amount: amount.toString(), note })),
    joined: [...facts.joined],
  };
}

/** The facts storeFacts kept, as they were. */
export function readFacts(stored: StoredWeekSummary): WeekSummaryFacts {
  return {
    week: BigInt(stored.week),
    block: BigInt(stored.block),
    startsAt: BigInt(stored.startsAt),
    endsAt: BigInt(stored.endsAt),
    balance: BigInt(stored.balance),
    dues: stored.dues.map(({ member, owed }) => ({ member: getAddress(member), owed: BigInt(owed) })),
    contributed: BigInt(stored.contributed),
    reimbursements: stored.reimbursements.map(({ member, amount }) => ({ member: getAddress(member), amount: BigInt(amount) })),
    payments: stored.payments.map(({ member, amount, note }) => ({ member: getAddress(member), amount: BigInt(amount), note })),
    joined: stored.joined.map((member) => getAddress(member)),
  };
}

/** A live fund, as writeWeekSummaries reads it from the database. */
export type SummaryFund = { id: string; address: Address; createdBlock: bigint; weeklyFee: bigint };

/** What writeWeekSummaries reads on the chain: chainWeekSummaryDeps reads it for real, a test stands in for it. */
export type WeekSummaryDeps = {
  /** The agent this web runs: a fund that names another one gets no summary. */
  agent: Address;
  /** The fund at the latest block: its week, its start, its agent and whether it's closed. */
  status: (fund: Address) => Promise<{ week: bigint; startTime: bigint; agent: Address; closed: boolean }>;
  /** The photo of the fund's week `week`, read at its last block. */
  facts: (fund: SummaryFund, week: bigint, startTime: bigint) => Promise<WeekSummaryFacts>;
};

type SummaryClient = Pick<PublicClient, "getBlock" | "getBlockNumber" | "multicall" | "readContract">;

/**
 * The chain's side of the summaries: Celo through CELO_RPC_URL, the history as the screens read it (Blockscout plus
 * the node; the node alone on the fork), and the agent every new fund names.
 */
export function chainWeekSummaryDeps(client: SummaryClient = celoClient(), logs: LogReader = logReader(), agent: Address = agentAddress()): WeekSummaryDeps {
  return {
    agent,
    status: async (fund) => {
      const [week, startTime, fundAgent, closed] = await client.multicall({
        allowFailure: false,
        contracts: [
          { address: fund, abi: fundAbi, functionName: "currentWeek" },
          { address: fund, abi: fundAbi, functionName: "startTime" },
          { address: fund, abi: fundAbi, functionName: "agent" },
          { address: fund, abi: fundAbi, functionName: "closed" },
        ],
      });
      return { week, startTime, agent: fundAgent, closed };
    },
    facts: async (fund, week, startTime) => {
      const { first, last } = await weekBlockRange(client, { startTime, week, from: fund.createdBlock });
      const snapshot = await readFund(client, fund.address, last);
      if (snapshot.week !== week) throw new Error(`Block ${last} is in week ${snapshot.week}, not in week ${week}`);
      const [balance, block, events] = await Promise.all([
        client.readContract({ address: fund.address, abi: memberFundAbi, functionName: "balanceInWars", blockNumber: last }),
        client.getBlock({ blockNumber: last }),
        readFundEvents(logs, fund.address, fund.createdBlock, last),
      ]);
      // A hole in the history would leave a reimbursement out of the summary: nothing is written from it.
      checkHistory(snapshot, events);
      const clock = { block: last, timestamp: block.timestamp };
      // The same weekOf as the screen (read-fund.ts), so the summary's dues are the week's list as it closed.
      const weekOf = (event: (typeof events)[number]) => weekAt(blockTime(event.blockNumber, clock), snapshot.startTime);
      return weekSummary({ fund: snapshot, balance, weeklyFee: fund.weeklyFee, events, first, weekOf });
    },
  };
}

/**
 * The heartbeat's step after its conversions (spec, 9.4): for each live fund of our agent, the photo of its last
 * week that closed, if it doesn't have one yet. Only that week, never an older one: after a heartbeat that was down
 * over a week, the skipped week gets none. A closed fund, or one that names another agent, gets none. A fund that
 * fails is logged and tried again on the next heartbeat, and the others go on: this never throws.
 */
export async function writeWeekSummaries(db: Db, deps: WeekSummaryDeps): Promise<void> {
  let live: { id: string; address: string | null; createdBlock: bigint | null; weeklyFee: bigint }[];
  try {
    live = await db
      .select({ id: funds.id, address: funds.address, createdBlock: funds.createdBlock, weeklyFee: funds.weeklyFee })
      .from(funds)
      .where(eq(funds.status, "live"));
  } catch (error) {
    console.error(`Could not list the funds for their week summaries: ${shortMessage(error)}`);
    return;
  }
  for (const row of live) {
    if (row.address === null) continue;
    const fund: SummaryFund = { id: row.id, address: getAddress(row.address), createdBlock: row.createdBlock ?? FUND_FACTORY_BLOCK, weeklyFee: row.weeklyFee };
    try {
      await writeLastWeek(db, deps, fund);
    } catch (error) {
      console.error(`Could not write the week summary of ${fund.address}: ${shortMessage(error)}`);
    }
  }
}

async function writeLastWeek(db: Db, deps: WeekSummaryDeps, fund: SummaryFund): Promise<void> {
  const status = await deps.status(fund.address);
  if (status.closed || !isAddressEqual(status.agent, deps.agent) || status.week === 0n) return;
  const week = status.week - 1n;
  const [kept] = await db
    .select({ week: weekSummaries.week })
    .from(weekSummaries)
    .where(and(eq(weekSummaries.fundId, fund.id), eq(weekSummaries.week, Number(week))));
  if (kept !== undefined) return;
  const facts = await deps.facts(fund, week, status.startTime);
  await db.insert(weekSummaries).values({ fundId: fund.id, week: Number(week), block: facts.block, facts: storeFacts(facts) }).onConflictDoNothing();
}
