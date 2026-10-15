import { and, eq, sql } from "drizzle-orm";
import { type Db, inTransaction } from "./db/client";
import { createFundNonces, users } from "./db/schema";

/**
 * The most createFund nonces the paymaster signs for one person, ever. A nonce lands at most once, so a creator gets
 * at most 3 createFunds sponsored: a legit one uses one per fund, and one more for each createFund that reverted
 * (retrying after a cancelled passkey prompt, or resending one that never came back, reuses the same nonce).
 */
export const MAX_CREATE_FUND_NONCES = 3;
/**
 * The key of the advisory lock every createFund claim takes first, and holds until its transaction ends: any number
 * works, as long as nothing else locks on it. One for everyone, because the daily cap counts everyone's rows.
 */
const CREATE_FUND_CLAIM_LOCK = 4_251_001;

/**
 * Both caps, as SQL conditions over create_fund_nonces: room for another nonce of `userId`'s, ever, and for another
 * among everyone in the last day, under `dailyLimit` (CREATE_FUND_DAILY_LIMIT, M4). Passkey accounts are free to
 * make, so throwaway ones could each take MAX_CREATE_FUND_NONCES and use up the month's sponsorship, the real groups'
 * contributions and votes with it; a real group creates a fund or two a day. The claim and the check before "Crear
 * fondo" both use these, so the screen never says one thing and the paymaster another.
 */
function caps(db: Db, userId: string, dailyLimit: number) {
  const signed = db.$count(createFundNonces, eq(createFundNonces.userId, userId));
  const signedToday = db.$count(createFundNonces, sql`${createFundNonces.createdAt} > now() - interval '1 day'`);
  return { account: sql<boolean>`${signed} < ${MAX_CREATE_FUND_NONCES}`, day: sql<boolean>`${signedToday} < ${dailyLimit}` };
}

/**
 * Whether the paymaster may sign `userId`'s createFund on `nonce`: it's one they already got signed (re-signing it
 * can't make it land twice), or a new one within both caps (`caps`), which it then counts. The count is exact,
 * however many claim at once: the lock on CREATE_FUND_CLAIM_LOCK comes first, so two claims never count the same
 * rows, and they are rare enough for queuing them one after another to cost nothing. The second waits for the first
 * to commit, and then reads what it left. That relies on READ COMMITTED, Neon's default (db/client.ts): each
 * statement sees what had committed when it began, so the counts, which come after the lock, see the other claim.
 * Under REPEATABLE READ they would miss it (M1).
 */
export async function claimCreateFundNonce(db: Db, userId: string, nonce: bigint, dailyLimit: number): Promise<boolean> {
  const [, , [claimed]] = await inTransaction(db, (tx) => {
    const room = caps(tx, userId, dailyLimit);
    return [
      tx.execute(sql`select pg_advisory_xact_lock(${CREATE_FUND_CLAIM_LOCK})`),
      tx
        .insert(createFundNonces)
        .select((qb) =>
          qb
            .select({ userId: users.id, nonce: sql<bigint>`${nonce.toString()}::numeric`.as("nonce"), createdAt: sql<Date>`now()`.as("created_at") })
            .from(users)
            .where(and(eq(users.id, userId), room.account, room.day)),
        )
        .onConflictDoNothing(),
      tx
        .select({ nonce: createFundNonces.nonce })
        .from(createFundNonces)
        .where(and(eq(createFundNonces.userId, userId), eq(createFundNonces.nonce, nonce))),
    ];
  });
  return claimed !== undefined;
}

/** What `createFundRoom` found: room for the createFund, or the cap that stops it. */
export type CreateFundRoom = "ok" | "account" | "day";

/**
 * Whether `claimCreateFundNonce` would sign `userId`'s createFund on `nonce` now, and if not, which cap stops it,
 * without claiming anything (M5): "Crear fondo" asks before it freezes the draft, so the creator reads why in their language
 * instead of a generic failure from the paymaster. The creator's own cap first: the day's would send them back
 * tomorrow for nothing. Only a hint: the claim still decides, and someone may take the day's last one in between.
 */
export async function createFundRoom(db: Db, userId: string, nonce: bigint, dailyLimit: number): Promise<CreateFundRoom> {
  const { account, day } = caps(db, userId, dailyLimit);
  const signed = db.$count(createFundNonces, and(eq(createFundNonces.userId, userId), eq(createFundNonces.nonce, nonce)));
  const [room] = await db
    .select({ signed: sql<boolean>`${signed} > 0`, account, day })
    .from(users)
    .where(eq(users.id, userId));
  if (room === undefined) return "account"; // no such person: like the claim, nothing would be signed for them
  if (room.signed) return "ok";
  if (!room.account) return "account";
  return room.day ? "ok" : "day";
}
