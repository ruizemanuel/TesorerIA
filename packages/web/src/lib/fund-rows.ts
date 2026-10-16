import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { funds, memberships } from "./db/schema";

/**
 * What funds.ts and join-requests.ts both do with a fund's rows. They live here because funds.ts imports
 * join-requests.ts (a live fund's link asks to join), so join-requests.ts can't import them back from funds.ts
 * without a cycle.
 */

/** A refusal with its HTTP status, in the shape of `FundsResult`. */
export const fail = (status: number, error: string) => ({ ok: false, status, error }) as const;

/**
 * Locks the fund's row until the transaction it's in ends. A join, a request to join and the deploy's freeze all take
 * it first, so they never interleave: one waits for the other to commit, and then reads what it left.
 */
export function lockFund(db: Db, fundId: string) {
  return db.select({ id: funds.id }).from(funds).where(eq(funds.id, fundId)).for("update");
}

export async function isMember(db: Db, fundId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.fundId, fundId), eq(memberships.userId, userId)));
  return row !== undefined;
}
