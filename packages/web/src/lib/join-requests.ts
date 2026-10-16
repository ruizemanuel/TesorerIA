import { and, desc, eq, ne, not, sql } from "drizzle-orm";
import { type Db, inTransaction } from "./db/client";
import { funds, joinRequests, memberships } from "./db/schema";
import { MAX_MEMBERS } from "./fund-abi";
import { fail, isMember, lockFund } from "./fund-rows";
import type { FundsResult } from "./funds";
import type { Messages } from "./i18n/messages";

/** A request to join is open for this many days from its date (spec, 9.4), on the database's clock. */
export const JOIN_REQUEST_DAYS = 7;
/** The open requests a live fund holds at once: passkeys cost nothing, and a fund's link may travel past the group. */
export const MAX_OPEN_JOIN_REQUESTS = 5;

/** Whether a request (its `join_requests.created_at`) is still open: decided by the database alone, never the chain (spec, 9.4). */
export function isOpenRequest() {
  return sql<boolean>`${joinRequests.createdAt} > now() - ${JOIN_REQUEST_DAYS} * interval '1 day'`;
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
    const waiting = tx.$count(joinRequests, and(eq(joinRequests.fundId, fundId), ne(joinRequests.userId, userId), isOpenRequest()));
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

/** A person's open requests, in live funds, newest first: where "Tus fondos" and the portada take them (spec, 9.4). */
export function requestsOf(db: Db, userId: string): Promise<{ fundId: string; name: string; inviteCode: string; requestedAt: Date }[]> {
  return db
    .select({ fundId: funds.id, name: funds.name, inviteCode: funds.inviteCode, requestedAt: joinRequests.createdAt })
    .from(joinRequests)
    .innerJoin(funds, eq(funds.id, joinRequests.fundId))
    .where(and(eq(joinRequests.userId, userId), eq(funds.status, "live"), isOpenRequest()))
    .orderBy(desc(joinRequests.createdAt));
}
