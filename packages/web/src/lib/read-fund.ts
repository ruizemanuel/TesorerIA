import { FUND_FACTORY_BLOCK, type FundEvent, type FundSnapshot, MIN_CONVERSION_USDT, joinWeeks, readFund, readFundEvents } from "@tesoreria/agent";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { type Address, getAddress, zeroAddress } from "viem";
import { celoClient, logReader } from "./chain";
import { blockTime, weekAt } from "./chain-time";
import type { CurrentUser } from "./current-user";
import { type Db, getDb } from "./db/client";
import { decisions, expenses, funds, memberships, users, weekSummaries } from "./db/schema";
import { env } from "./env";
import { MAX_MEMBERS, memberFundAbi } from "./fund-abi";
import { type FundView, buildFundView } from "./fund-view";
import { checkHistory } from "./history";
import type { Locale } from "./i18n/locales";
import { messagesFor } from "./i18n/messages";
import { JOIN_REQUEST_DAYS, admitMembers, joinRequestOf, requestsIn } from "./join-requests";
import { ttlMemo } from "./memo";
import { cashOutPending, lastOperationBlock, pendingOperations } from "./operations";
import { waitForBlock } from "./read-your-writes";
import { type ConversionHold, type ProposalState, type TimelineItem, buildTimeline } from "./timeline";
import { readFacts, weekSummaryText } from "./week-summaries";

export type FundScreen = {
  fundId: string;
  /** The block everything on the screen was read at. */
  block: bigint;
  view: FundView;
  timeline: TimelineItem[];
  /** The agent's summary of each week that closed (spec, 9.4), newest first: the text that goes to the group. */
  weekSummaries: { week: number; text: string }[];
  viewerIsMember: boolean;
  publicView: boolean;
  /** The viewer has a contribution here that went out and has no receipt yet: Aportar must not offer to send another. */
  contributionOnItsWay: boolean;
  /** The viewer has a pass to pesos that went out and has no receipt yet: Pasar a pesos must not offer to send another. */
  cashOutOnItsWay: boolean;
};

// The history check lives in history.ts (week-summaries.ts needs it too); these names stay importable from here.
export { HistoryGapError, checkHistory } from "./history";

/** A fund's members in the database: their names and accounts. */
function peopleOf(db: Db, fundId: string) {
  return db
    .select({ userId: users.id, name: users.name, account: users.account })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.fundId, fundId));
}

/**
 * Everything one screen of a live fund needs (spec, 9.2). Null when the fund isn't ours, isn't live, or the
 * viewer may not see it: a member sees their fund; anyone sees a fund whose public view is on. What the server writes
 * on it (the movements, the names of a public view) is in `locale`, the page's language (spec, 9.3).
 */
export async function loadFundScreen(
  address: Address,
  viewer: CurrentUser | null,
  { publicView = false, locale }: { publicView?: boolean; locale: Locale },
): Promise<FundScreen | null> {
  const m = messagesFor(locale);
  const db = await getDb();
  const [fund] = await db
    .select()
    .from(funds)
    .where(and(eq(funds.address, getAddress(address)), eq(funds.status, "live")));
  if (fund === undefined || (publicView && !fund.publicView)) return null;
  let people = await peopleOf(db, fund.id);
  let viewerIsMember = viewer !== null && people.some((p) => p.userId === viewer.id);
  // Someone the group just voted in may open the fund before anyone admitted them (below), from another device: only
  // someone with a request here gets past this without being a member, and only to be admitted (spec, 9.4).
  const mayBeIn = !publicView && !viewerIsMember && viewer !== null && (await joinRequestOf(db, fund.id, viewer.id)) !== null;
  if (!publicView && !viewerIsMember && !mayBeIn) return null;

  // The balance, the block's time and the history are all read up to the snapshot's block.
  const client = celoClient();
  // Read-your-writes: the viewer's own last operation is on the screen even when the node is a block behind (spec, 9.2).
  const mine = publicView || viewer === null ? null : await lastOperationBlock(db, viewer.id, getAddress(address));
  if (mine !== null) await waitForBlock(client, mine);
  const snapshot = await readFund(client, getAddress(address));
  // The chain says who is in: whoever it added since their request gets their row, and their request goes (spec, 9.4).
  if ((await admitMembers(db, fund.id, snapshot.members)).length > 0) {
    people = await peopleOf(db, fund.id);
    viewerIsMember = viewer !== null && people.some((p) => p.userId === viewer.id);
  }
  if (!publicView && !viewerIsMember) return null;
  const [balance, block, events] = await Promise.all([
    client.readContract({ address: snapshot.address, abi: memberFundAbi, functionName: "balanceInWars", blockNumber: snapshot.block }),
    client.getBlock({ blockNumber: snapshot.block }),
    readFundEvents(logReader(), snapshot.address, fund.createdBlock ?? FUND_FACTORY_BLOCK, snapshot.block),
  ]);
  const clock = { block: snapshot.block, timestamp: block.timestamp };
  checkHistory(snapshot, events);

  // Names by account. A public view without the group's OK shows "Miembro N", in the contract's order.
  const names = new Map<Address, string>();
  if (publicView && !fund.publicNames) snapshot.members.forEach((member, i) => names.set(getAddress(member), m.common.member(i + 1)));
  else for (const p of people) names.set(getAddress(p.account), p.name);
  // Who asked to join, for their request and its proposal: never on the public view, which shows no requests.
  const requests = publicView ? [] : await requestsIn(db, fund.id);
  for (const request of requests) if (!names.has(request.account)) names.set(request.account, request.name);

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

  const hold = await conversionHold(db, snapshot);

  // The agent's photos of the weeks that closed (spec, 9.4), newest first, written in the page's language with the
  // screen's names. The link to the fund goes only to a member: the public view has nobody to send it to.
  const summaryRows = await db
    .select({ week: weekSummaries.week, facts: weekSummaries.facts, createdAt: weekSummaries.createdAt })
    .from(weekSummaries)
    .where(eq(weekSummaries.fundId, fund.id))
    .orderBy(desc(weekSummaries.week));
  const link = publicView ? null : `${env().ORIGIN}/f/${snapshot.address}`;
  const summaryTexts = summaryRows.map((row) => ({
    week: row.week,
    text: weekSummaryText(readFacts(row.facts), { fundName: fund.name, agreedExpense: fund.agreedExpense, names, link }, m),
  }));

  const view = buildFundView({
    snapshot,
    name: fund.name,
    agreedExpense: fund.agreedExpense,
    balance,
    weeklyFee: fund.weeklyFee,
    joined,
    names,
    viewer: publicView ? null : (viewer?.account ?? null),
    m,
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
    joinRequests: requests.map((request) => ({
      account: request.account,
      name: request.name,
      at: request.open ? request.requestedAt : new Date(request.requestedAt.getTime() + JOIN_REQUEST_DAYS * 86_400_000),
      open: request.open,
    })),
    canAddMembers: snapshot.members.length < MAX_MEMBERS,
    conversionHold: hold,
    summaries: summaryRows.map((row) => ({ week: row.week, at: row.createdAt })),
    warsBalance: snapshot.warsBalance,
    viewerIsMember: !publicView && viewerIsMember,
    now: new Date(Number(clock.timestamp) * 1000),
    m,
  });
  const contributionOnItsWay = pending.some((operation) => operation.kind === "contribute");
  const cashOutOnItsWay = !publicView && viewer !== null && viewerIsMember ? await cashOutPending(db, viewer.id) : false;
  return {
    fundId: fund.id,
    block: snapshot.block,
    view,
    timeline,
    weekSummaries: summaryTexts,
    viewerIsMember,
    publicView,
    contributionOnItsWay,
    cashOutOnItsWay,
  };
}

/**
 * The public screen of a fund (spec, 9.2), read at most once every 45 seconds per fund and per language: the portada
 * and /publico are open to anyone, and every hit would otherwise read the chain. It's the same for every viewer of a
 * language, which is why only it is kept; a member's screens are always read fresh. The key carries the language
 * because the screen's sentences are written on the server (spec, 9.3): without it, a visitor in English could be
 * handed the one written in Spanish for someone else.
 */
const publicFundScreen = ttlMemo("public-fund-screen", 45_000, (key) => {
  const [locale, address] = key.split(":") as [Locale, Address];
  return loadFundScreen(address, null, { publicView: true, locale });
});

/** The public screen of a fund, kept per fund and per language: its sentences are written on the server (spec, 9.3). */
export function loadPublicFundScreen(address: Address, locale: Locale): Promise<FundScreen | null> {
  return publicFundScreen(`${locale}:${getAddress(address)}`);
}

/**
 * Why the agent hasn't converted the USDT the fund holds (spec, 8.1, F8): its latest decision on the fund, when it
 * skipped the conversion, was blocked, or sent one that reverted. Null under MIN_CONVERSION_USDT (the agent leaves
 * that much where it is), or when its latest decision was a conversion that went through. Only a decision of the
 * last half hour counts: the heartbeat decides again every 15 minutes while USDT waits, so an older one may be about
 * other USDT (a run that couldn't read the fund, with nothing to convert, before this USDT came). Both addresses are
 * checksummed: the agent's come from viem's decoding, and this one from getAddress.
 */
async function conversionHold(db: Db, snapshot: FundSnapshot): Promise<ConversionHold | null> {
  if (snapshot.usdtBalance < MIN_CONVERSION_USDT) return null;
  const [latest] = await db
    .select({ kind: decisions.kind, code: decisions.code, status: decisions.status, createdAt: decisions.createdAt })
    .from(decisions)
    .where(
      and(
        eq(decisions.fund, snapshot.address),
        isNull(decisions.expenseId),
        sql`${decisions.createdAt} > now() - interval '30 minutes'`,
      ),
    )
    .orderBy(desc(decisions.createdAt), desc(decisions.id))
    .limit(1);
  if (latest === undefined) return null;
  const held = latest.kind === "skip" || latest.kind === "blocked" || (latest.kind === "convert" && latest.status === "reverted");
  return held ? { usdt: snapshot.usdtBalance, code: latest.kind === "skip" ? latest.code : null, at: latest.createdAt } : null;
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
