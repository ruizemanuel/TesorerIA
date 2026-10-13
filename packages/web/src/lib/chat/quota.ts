import { and, eq, sql } from "drizzle-orm";
import { type Db, inTransaction } from "../db/client";
import { chatMessages, users } from "../db/schema";

/**
 * The key of the advisory lock every chat reservation takes first, and holds until its transaction ends: any number
 * nothing else locks on (CREATE_FUND_CLAIM_LOCK is 4_251_001). One for everyone, because the global cap counts all.
 */
export const CHAT_RESERVE_LOCK = 4_251_002;

export type Reservation = { ok: true; id: string; remaining: number } | { ok: false; limit: "member" | "global" };

/**
 * Keeps one message of `userId` (spec, 8.2) if both caps have room: their messages in the last 24 hours, in any fund,
 * under `memberLimit`, and everyone's under `globalLimit`. Then it says how many the member has left; otherwise which
 * cap stopped it. It's one batch (Neon's HTTP driver has no interactive transactions): the lock, an insert that
 * selects nothing once a cap is reached, and the counts, which see that insert since they run in its transaction.
 */
export async function reserveChatMessage(
  db: Db,
  { userId, fundId, memberLimit, globalLimit }: { userId: string; fundId: string; memberLimit: number; globalLimit: number },
): Promise<Reservation> {
  const [, inserted, [counts]] = await inTransaction(db, (tx) => {
    const lastDay = sql`${chatMessages.createdAt} > now() - interval '1 day'`;
    const mine = tx.$count(chatMessages, and(eq(chatMessages.userId, userId), lastDay));
    const everyone = tx.$count(chatMessages, lastDay);
    return [
      tx.execute(sql`select pg_advisory_xact_lock(${CHAT_RESERVE_LOCK})`),
      tx
        .insert(chatMessages)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`gen_random_uuid()`.as("id"),
              userId: users.id,
              fundId: sql<string>`${fundId}::uuid`.as("fund_id"),
              inputTokens: sql<number | null>`null::integer`.as("input_tokens"),
              outputTokens: sql<number | null>`null::integer`.as("output_tokens"),
              finish: sql<string | null>`null::text`.as("finish"),
              createdAt: sql<Date>`now()`.as("created_at"),
            })
            .from(users)
            .where(and(eq(users.id, userId), sql`${mine} < ${memberLimit}`, sql`${everyone} < ${globalLimit}`)),
        )
        .returning({ id: chatMessages.id }),
      tx.select({ mine, everyone }).from(users).where(eq(users.id, userId)),
    ];
  });
  const id = inserted[0]?.id;
  const mineNow = Number(counts?.mine ?? memberLimit);
  if (id !== undefined) return { ok: true, id, remaining: Math.max(0, memberLimit - mineNow) };
  return { ok: false, limit: mineNow >= memberLimit ? "member" : "global" };
}

/** What a message cost and how its answer ended (spec, 8.2). Never its text. */
export async function recordChatUsage(
  db: Db,
  id: string,
  { inputTokens, outputTokens, finish }: { inputTokens?: number; outputTokens?: number; finish: string },
): Promise<void> {
  await db
    .update(chatMessages)
    .set({ inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null, finish })
    .where(eq(chatMessages.id, id));
}
