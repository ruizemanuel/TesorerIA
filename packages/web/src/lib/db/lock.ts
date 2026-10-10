import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./client";
import { locks } from "./schema";

/**
 * Takes the lock `name` for `owner` for `ttlMs`, if nobody holds it or the holder's time ran out. The expiry
 * is compared on the database's clock, the same one that wrote it.
 */
export async function acquireLock(db: Db, name: string, owner: string, ttlMs: number): Promise<boolean> {
  const expiresAt = sql`now() + ${ttlMs} * interval '1 millisecond'`;
  const rows = await db
    .insert(locks)
    .values({ name, owner, expiresAt })
    .onConflictDoUpdate({ target: locks.name, set: { owner, expiresAt }, setWhere: lt(locks.expiresAt, sql`now()`) })
    .returning({ owner: locks.owner });
  return rows[0]?.owner === owner;
}

/** Releases the lock if `owner` still holds it; someone else's lock is left alone. */
export async function releaseLock(db: Db, name: string, owner: string): Promise<void> {
  await db.delete(locks).where(and(eq(locks.name, name), eq(locks.owner, owner)));
}

/** Runs `fn` holding the lock, or doesn't run it if someone else holds it. */
export async function withLock<T>(
  db: Db,
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const owner = randomUUID();
  if (!(await acquireLock(db, name, owner, ttlMs))) return { ran: false };
  try {
    return { ran: true, value: await fn() };
  } finally {
    await releaseLock(db, name, owner);
  }
}
