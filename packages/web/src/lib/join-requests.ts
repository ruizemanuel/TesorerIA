import { fundAbi, shortMessage } from "@tesoreria/agent";
import { and, asc, desc, eq, inArray, isNotNull, ne, not, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Address, type PublicClient, getAddress, isAddressEqual } from "viem";
import { type Db, inTransaction } from "./db/client";
import { funds, joinRequests, memberships, users } from "./db/schema";
import { MAX_MEMBERS, ProposalAction, memberFundAbi } from "./fund-abi";
import { fail, isMember, lockFund } from "./fund-rows";
import type { DraftSummary, FundsResult } from "./funds";
import type { Messages } from "./i18n/messages";

/** A request to join is open for this many days from its date (spec, 9.4), on the database's clock. */
export const JOIN_REQUEST_DAYS = 7;
/** The open requests a live fund holds at once: passkeys cost nothing, and a fund's link may travel past the group. */
export const MAX_OPEN_JOIN_REQUESTS = 5;

/** Whether a request (its `join_requests.created_at`) is still open: decided by the database alone, never the chain (spec, 9.4). */
export function isOpenRequest() {
  return sql<boolean>`${joinRequests.createdAt} > now() - ${JOIN_REQUEST_DAYS} * interval '1 day'`;
}

/** The open requests in `fundId` from anyone but `exceptUserId` (all of them for null): the ones the cap of MAX_OPEN_JOIN_REQUESTS counts. */
function openFromOthers(fundId: string, exceptUserId: string | null) {
  return and(eq(joinRequests.fundId, fundId), exceptUserId === null ? undefined : ne(joinRequests.userId, exceptUserId), isOpenRequest());
}

/**
 * How many open requests `fundId` holds from people other than `exceptUserId`: at MAX_OPEN_JOIN_REQUESTS, the fund
 * takes no more, and the invitation says so before anyone makes an account for it (invitationFor).
 */
export function openRequestsFromOthers(db: Db, fundId: string, exceptUserId: string | null): Promise<number> {
  return db.$count(joinRequests, openFromOthers(fundId, exceptUserId));
}

/**
 * Asks to join the live fund `fundId` for `userId` (spec, 9.4): a new request, the same one again (a double tap or two
 * tabs keep one row, with its first date), or a renewed one once it expired. Not for a member, nor while the fund has
 * MAX_MEMBERS members or MAX_OPEN_JOIN_REQUESTS other open requests. Members are counted in `memberships`, without
 * the chain: they lag it only until admitMembers runs, and a proposal for an eleventh couldn't be carried out anyway.
 * The fund's row is locked first, as joinFund does, so two people asking at once never both get the last place.
 */
export async function requestToJoin(db: Db, fundId: string, userId: string, m: Messages): Promise<FundsResult<{ requestedAt: Date }>> {
  const [fund] = await db.select({ status: funds.status }).from(funds).where(eq(funds.id, fundId));
  if (fund?.status !== "live") return fail(404, m.funds.badInvite);
  if (await isMember(db, fundId, userId)) return fail(409, m.funds.alreadyMember);
  await inTransaction(db, (tx) => {
    const members = tx.$count(memberships, eq(memberships.fundId, fundId));
    const waiting = tx.$count(joinRequests, openFromOthers(fundId, userId));
    return [
      lockFund(tx, fundId),
      tx
        .insert(joinRequests)
        .select((qb) =>
          qb
            .select({ fundId: funds.id, userId: sql<string>`${userId}::uuid`.as("user_id"), createdAt: sql<Date>`now()`.as("created_at") })
            .from(funds)
            .where(and(eq(funds.id, fundId), sql`${members} < ${MAX_MEMBERS}`, sql`${waiting} < ${MAX_OPEN_JOIN_REQUESTS}`)),
        )
        // An open request stays as it is; an expired one starts again from now.
        .onConflictDoUpdate({ target: [joinRequests.fundId, joinRequests.userId], set: { createdAt: sql`now()` }, setWhere: not(isOpenRequest()) }),
    ];
  });
  const request = await joinRequestOf(db, fundId, userId);
  if (request?.open) return { ok: true, requestedAt: request.requestedAt };
  // Nothing was written: the fund filled up, or others took the open places.
  const full = (await db.$count(memberships, eq(memberships.fundId, fundId))) >= MAX_MEMBERS;
  return fail(409, full ? m.funds.liveFull : m.funds.manyRequests);
}

/** `userId`'s request to join `fundId`, open or not, or null if they never asked (or the chain already let them in). */
export async function joinRequestOf(db: Db, fundId: string, userId: string): Promise<{ requestedAt: Date; open: boolean } | null> {
  const [row] = await db
    .select({ requestedAt: joinRequests.createdAt, open: isOpenRequest() })
    .from(joinRequests)
    .where(and(eq(joinRequests.fundId, fundId), eq(joinRequests.userId, userId)));
  return row ?? null;
}

/**
 * A person's requests to join live funds, newest first (an open request is always newer than an expired one, so it
 * comes before it). Only the open ones by default, which is what "Tus fondos" lists (spec, 9.4 C); with
 * `includeExpired`, the expired ones too, which is what the home page takes someone with no fund to: the invitation
 * still admits them if a proposal carried them in after the request expired, and otherwise offers to ask again.
 */
export function requestsOf(
  db: Db,
  userId: string,
  { includeExpired = false }: { includeExpired?: boolean } = {},
): Promise<{ fundId: string; name: string; inviteCode: string; requestedAt: Date }[]> {
  return db
    .select({ fundId: funds.id, name: funds.name, inviteCode: funds.inviteCode, requestedAt: joinRequests.createdAt })
    .from(joinRequests)
    .innerJoin(funds, eq(funds.id, joinRequests.fundId))
    .where(and(eq(joinRequests.userId, userId), eq(funds.status, "live"), includeExpired ? undefined : isOpenRequest()))
    .orderBy(desc(joinRequests.createdAt));
}

/**
 * The open requests in the live funds `userId` is a member of, with the account each one asked from: the only accounts
 * that person's sponsored propose may add (checkCalls, spec 9.4). None in a fund that already has MAX_MEMBERS members,
 * whose AddMember the contract would refuse (Review Focus 4).
 */
export async function sponsoredJoinRequests(db: Db, userId: string): Promise<{ fund: Address; account: Address }[]> {
  const mine = alias(memberships, "mine");
  const rows = await db
    .select({ fund: funds.address, account: users.account })
    .from(joinRequests)
    .innerJoin(funds, eq(funds.id, joinRequests.fundId))
    .innerJoin(users, eq(users.id, joinRequests.userId))
    .innerJoin(mine, and(eq(mine.fundId, joinRequests.fundId), eq(mine.userId, userId)))
    .where(
      and(
        eq(funds.status, "live"),
        isNotNull(funds.address),
        isOpenRequest(),
        sql`${db.$count(memberships, eq(memberships.fundId, funds.id))} < ${MAX_MEMBERS}`,
      ),
    );
  return rows.map((row) => ({ fund: getAddress(row.fund!), account: getAddress(row.account) }));
}

/** Everyone with a request to join `fundId`, open or not, oldest first: their name and account, for its movements. */
export async function requestsIn(
  db: Db,
  fundId: string,
): Promise<{ userId: string; name: string; account: Address; requestedAt: Date; open: boolean }[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, account: users.account, requestedAt: joinRequests.createdAt, open: isOpenRequest() })
    .from(joinRequests)
    .innerJoin(users, eq(users.id, joinRequests.userId))
    .where(eq(joinRequests.fundId, fundId))
    .orderBy(asc(joinRequests.createdAt));
  return rows.map((row) => ({ ...row, account: getAddress(row.account) }));
}

/**
 * Gives a membership row to each of `members` (the fund's members on the chain) who asked to join `fundId` and has none,
 * and drops their request (spec, 9.4). The chain decides who is in: this only catches the database up, wherever the
 * proposal was carried out from. Nobody gets in without a request. The user ids it admitted.
 */
export async function admitMembers(db: Db, fundId: string, members: readonly Address[]): Promise<string[]> {
  if (members.length === 0) return [];
  const waiting = await db
    .select({ userId: joinRequests.userId })
    .from(joinRequests)
    .innerJoin(users, eq(users.id, joinRequests.userId))
    .where(and(eq(joinRequests.fundId, fundId), inArray(users.account, members.map((member) => getAddress(member)))));
  if (waiting.length === 0) return [];
  const ids = waiting.map((row) => row.userId);
  await inTransaction(db, (tx) => [
    tx
      .insert(memberships)
      .values(ids.map((userId) => ({ fundId, userId })))
      .onConflictDoNothing(),
    tx.delete(joinRequests).where(and(eq(joinRequests.fundId, fundId), inArray(joinRequests.userId, ids))),
  ]);
  return ids;
}

/** How many of a fund's latest proposals the invitation looks through for one adding the viewer: a proposal lasts 7 days. */
const RECENT_PROPOSALS = 20n;

/** Where an account stands on a fund's chain (spec, 9.4): a member, or with an open AddMember proposal, or neither. */
export type JoinProgress = { member: boolean; proposal: { proposer: Address; votes: number; required: number } | null };

/** Reads where `account` stands on `fund`: whether it's a member, and the latest open proposal that adds it. */
export async function joinProgress(client: Pick<PublicClient, "readContract" | "getBlock">, fund: Address, account: Address): Promise<JoinProgress> {
  if (await client.readContract({ address: fund, abi: memberFundAbi, functionName: "isMember", args: [account] })) return { member: true, proposal: null };
  const [count, block] = await Promise.all([client.readContract({ address: fund, abi: memberFundAbi, functionName: "proposalCount" }), client.getBlock()]);
  const oldest = count > RECENT_PROPOSALS ? count - RECENT_PROPOSALS : 0n;
  for (let id = count - 1n; id >= oldest; id--) {
    const proposal = await client.readContract({ address: fund, abi: memberFundAbi, functionName: "getProposal", args: [id] });
    // Open as the contract has it (Fund._activeProposal): not carried out, and not past its deadline.
    if (proposal.action !== ProposalAction.AddMember || !isAddressEqual(proposal.a, account)) continue;
    if (proposal.executed || BigInt(proposal.deadline) < block.timestamp) continue;
    const [votes, required] = await Promise.all([
      client.readContract({ address: fund, abi: memberFundAbi, functionName: "voteCount", args: [id] }),
      client.readContract({ address: fund, abi: fundAbi, functionName: "votesRequired" }),
    ]);
    return { member: false, proposal: { proposer: getAddress(proposal.proposer), votes: Number(votes), required } };
  }
  return { member: false, proposal: null };
}

/** What the invitation of a live fund shows someone logged in who isn't in it (spec, 9.4). */
export type JoinState = {
  request: { requestedAt: Date; open: boolean } | null;
  /** An open proposal to add them: who made it, by name, and its votes. */
  proposal: { proposer: string; votes: number; required: number } | null;
  /** The chain had them already, and now the fund does: the invitation takes them to it. */
  admitted: boolean;
};

export const NO_JOIN: JoinState = { request: null, proposal: null, admitted: false };

/**
 * Where `viewer`'s request to join `fund` stands, reading the chain only for someone with a request in a live fund
 * they aren't in yet: if the chain already added them, they're admitted here. If the chain can't be read, the request
 * is shown as the database has it, and the next visit reads it again.
 */
export async function joinStateOf(
  db: Db,
  client: Pick<PublicClient, "readContract" | "getBlock">,
  fund: Pick<DraftSummary, "id" | "status" | "address" | "members">,
  viewer: { id: string; account: Address },
  m: Messages,
): Promise<JoinState> {
  if (fund.status !== "live" || fund.address === null || fund.members.some((member) => member.userId === viewer.id)) return NO_JOIN;
  const request = await joinRequestOf(db, fund.id, viewer.id);
  if (request === null) return NO_JOIN;
  let progress: JoinProgress;
  try {
    progress = await joinProgress(client, fund.address, viewer.account);
  } catch (error) {
    console.error(`Could not read how a request to join stands: ${shortMessage(error)}`);
    return { request, proposal: null, admitted: false };
  }
  if (progress.member) {
    await admitMembers(db, fund.id, [viewer.account]);
    return { request, proposal: null, admitted: true };
  }
  if (progress.proposal === null) return { request, proposal: null, admitted: false };
  const { proposer, votes, required } = progress.proposal;
  const name = fund.members.find((member) => isAddressEqual(member.account, proposer))?.name ?? m.timeline.someone;
  return { request, proposal: { proposer: name, votes, required }, admitted: false };
}
