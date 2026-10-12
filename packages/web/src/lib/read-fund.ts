import { FUND_FACTORY_BLOCK, type FundEvent, type FundSnapshot, joinWeeks, readFund, readFundEvents } from "@tesoreria/agent";
import { and, desc, eq } from "drizzle-orm";
import { type Address, getAddress, zeroAddress } from "viem";
import { celoClient, logReader } from "./chain";
import { blockTime, weekAt } from "./chain-time";
import type { CurrentUser } from "./current-user";
import { getDb } from "./db/client";
import { expenses, funds, memberships, users } from "./db/schema";
import { memberFundAbi } from "./fund-abi";
import { type FundView, buildFundView } from "./fund-view";
import { ttlMemo } from "./memo";
import { pendingOperations } from "./operations";
import { type ProposalState, type TimelineItem, buildTimeline } from "./timeline";

export type FundScreen = {
  fundId: string;
  /** The block everything on the screen was read at. */
  block: bigint;
  view: FundView;
  timeline: TimelineItem[];
  viewerIsMember: boolean;
  publicView: boolean;
  /** The viewer has a contribution here that went out and has no receipt yet: Aportar must not offer to send another. */
  contributionOnItsWay: boolean;
};

/** The history read doesn't add up: some event is missing, so nothing is shown from it. */
export class HistoryGapError extends Error {
  override name = "HistoryGapError";
}

/**
 * Only reimbursements add to spentInWeek (Fund.sol), so this week's Reimbursement events must sum to it.
 * If they don't, the history read has a hole.
 */
export function checkHistory(snapshot: FundSnapshot, events: readonly FundEvent[]): void {
  let reimbursed = 0n;
  for (const e of events) if (e.eventName === "Reimbursement" && e.args.week === snapshot.week) reimbursed += e.args.amount;
  if (reimbursed !== snapshot.spentThisWeek) {
    throw new HistoryGapError(`This week's reimbursements add up to ${reimbursed}, but spentInWeek is ${snapshot.spentThisWeek}`);
  }
}

/**
 * Everything one screen of a live fund needs (spec, 9.2). Null when the fund isn't ours, isn't live, or the
 * viewer may not see it: a member sees their fund; anyone sees a fund whose public view is on.
 */
export async function loadFundScreen(
  address: Address,
  viewer: CurrentUser | null,
  { publicView = false }: { publicView?: boolean } = {},
): Promise<FundScreen | null> {
  const db = await getDb();
  const [fund] = await db
    .select()
    .from(funds)
    .where(and(eq(funds.address, getAddress(address)), eq(funds.status, "live")));
  if (fund === undefined || (publicView && !fund.publicView)) return null;
  const people = await db
    .select({ userId: users.id, name: users.name, account: users.account })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.fundId, fund.id));
  const viewerIsMember = viewer !== null && people.some((p) => p.userId === viewer.id);
  if (!publicView && !viewerIsMember) return null;

  // The balance, the block's time and the history are all read up to the snapshot's block.
  const client = celoClient();
  const snapshot = await readFund(client, getAddress(address));
  const [balance, block, events] = await Promise.all([
    client.readContract({ address: snapshot.address, abi: memberFundAbi, functionName: "balanceInWars", blockNumber: snapshot.block }),
    client.getBlock({ blockNumber: snapshot.block }),
    readFundEvents(logReader(), snapshot.address, fund.createdBlock ?? FUND_FACTORY_BLOCK, snapshot.block),
  ]);
  const clock = { block: snapshot.block, timestamp: block.timestamp };
  checkHistory(snapshot, events);

  // Names by account. A public view without the group's OK shows "Miembro N", in the contract's order.
  const names = new Map<Address, string>();
  if (publicView && !fund.publicNames) snapshot.members.forEach((m, i) => names.set(getAddress(m), `Miembro ${i + 1}`));
  else for (const p of people) names.set(getAddress(p.account), p.name);

  const joined = joinWeeks(events, (e) => weekAt(blockTime(e.blockNumber, clock), snapshot.startTime));
  const proposals = await readProposals(snapshot, events, publicView ? null : (viewer?.account ?? null));

  const expenseRows = publicView
    ? []
    : await db
        .select({ id: expenses.id, by: users.name, amount: expenses.amount, note: expenses.note, status: expenses.status, createdAt: expenses.createdAt })
        .from(expenses)
        .innerJoin(users, eq(users.id, expenses.userId))
        .where(eq(expenses.fundId, fund.id))
        .orderBy(desc(expenses.createdAt))
        .limit(20);
  const pending = !publicView && viewer !== null && viewerIsMember ? await pendingOperations(db, viewer.id, snapshot.address) : [];

  const view = buildFundView({
    snapshot,
    name: fund.name,
    agreedExpense: fund.agreedExpense,
    balance,
    weeklyFee: fund.weeklyFee,
    joined,
    names,
    viewer: publicView ? null : (viewer?.account ?? null),
  });
  const timeline = buildTimeline({
    events,
    clock,
    agent: snapshot.agent,
    names,
    agreedExpense: fund.agreedExpense,
    initialWeeklyCap: fund.weeklyCap,
    startTime: snapshot.startTime,
    votesRequired: snapshot.votesRequired,
    memberCount: snapshot.members.length,
    proposals,
    expenses: expenseRows,
    pending,
    viewerIsMember: !publicView && viewerIsMember,
    now: new Date(Number(clock.timestamp) * 1000),
  });
  const contributionOnItsWay = pending.some((operation) => operation.kind === "contribute");
  return { fundId: fund.id, block: snapshot.block, view, timeline, viewerIsMember, publicView, contributionOnItsWay };
}

/**
 * The public screen of the fund at `address` (spec, 9.2), read at most once every 45 seconds per fund: the portada
 * and /publico are open to anyone, and every hit would otherwise read the chain. It's the same for every viewer,
 * which is why only it is kept; a member's screens are always read fresh.
 */
const publicFundScreen = ttlMemo("public-fund-screen", 45_000, (address) =>
  loadFundScreen(address as Address, null, { publicView: true }),
);

export function loadPublicFundScreen(address: Address): Promise<FundScreen | null> {
  return publicFundScreen(getAddress(address));
}

/** Each proposal's state now: votes, executed, deadline, and whether `viewer` voted. */
async function readProposals(snapshot: FundSnapshot, events: readonly FundEvent[], viewer: Address | null) {
  const proposals = new Map<bigint, ProposalState>();
  const ids = events.flatMap((e) => (e.eventName === "ProposalCreated" ? [e.args.id] : []));
  if (ids.length === 0) return proposals;
  const client = celoClient();
  const address = snapshot.address;
  const reads = await Promise.all(
    ids.map((id) =>
      Promise.all([
        client.readContract({ address, abi: memberFundAbi, functionName: "getProposal", args: [id], blockNumber: snapshot.block }),
        client.readContract({ address, abi: memberFundAbi, functionName: "voteCount", args: [id], blockNumber: snapshot.block }),
        client.readContract({ address, abi: memberFundAbi, functionName: "hasVoted", args: [id, viewer ?? zeroAddress], blockNumber: snapshot.block }),
      ]),
    ),
  );
  ids.forEach((id, i) => {
    const [proposal, votes, voted] = reads[i]!;
    proposals.set(id, { votes: Number(votes), executed: proposal.executed, deadline: BigInt(proposal.deadline), voted });
  });
  return proposals;
}
