import { and, desc, eq, gt, isNull, max } from "drizzle-orm";
import type { Address, Hash } from "viem";
import type { Db } from "./db/client";
import { funds, operations } from "./db/schema";

export type OperationInput = {
  userOpHash: Hash;
  kind: "create-fund" | "contribute" | "vote";
  fund?: Address;
  amount?: bigint;
  token?: "wars" | "usdt";
  /** For `create-fund`: the draft (a `funds` row) it deploys. */
  draftId?: string;
  /** For `create-fund`: its EntryPoint nonce, on key 0. */
  nonce?: bigint;
};

/** After this long without a receipt, an operation stops showing as "en camino" (and a createFund may be released, see funds.ts). */
export const PENDING_FOR_MS = 15 * 60_000;

/** Keeps a member's operation as soon as the bundler took it, before its receipt (spec, 6). */
export async function recordOperation(db: Db, userId: string, input: OperationInput): Promise<void> {
  await db
    .insert(operations)
    .values({
      userId,
      userOpHash: input.userOpHash,
      kind: input.kind,
      fund: input.fund ?? null,
      draftId: input.draftId ?? null,
      amount: input.amount ?? null,
      token: input.token ?? null,
      nonce: input.nonce ?? null,
    })
    .onConflictDoNothing();
}

/** Whether this member created the draft: only they can say an operation deploys it. */
export async function ownsDraft(db: Db, userId: string, draftId: string): Promise<boolean> {
  const [draft] = await db
    .select({ id: funds.id })
    .from(funds)
    .where(and(eq(funds.id, draftId), eq(funds.creatorId, userId)));
  return draft !== undefined;
}

/**
 * Its receipt arrived. Only the member who sent it can say so. `block` is the receipt's block; a page loaded before
 * it was asked for doesn't send it.
 */
export async function finishOperation(
  db: Db,
  userId: string,
  { userOpHash, transactionHash, success, block }: { userOpHash: Hash; transactionHash: Hash; success: boolean; block?: bigint },
): Promise<void> {
  await db
    .update(operations)
    .set({ transactionHash, success, block: block ?? null })
    .where(and(eq(operations.userOpHash, userOpHash), eq(operations.userId, userId)));
}

/**
 * The latest block one of this member's operations landed in, in `fund` or in any fund: what their next read of the
 * chain has to reach to show it (read-your-writes, spec 9.2). Null when none was recorded with its block.
 */
export async function lastOperationBlock(db: Db, userId: string, fund?: Address): Promise<bigint | null> {
  const [row] = await db
    .select({ block: max(operations.block) })
    .from(operations)
    .where(and(eq(operations.userId, userId), fund === undefined ? undefined : eq(operations.fund, fund)));
  return row?.block ?? null;
}

/** A member's operations in a fund still on their way, newest first. */
export async function pendingOperations(db: Db, userId: string, fund: Address, now = new Date()) {
  return db
    .select()
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.fund, fund),
        isNull(operations.transactionHash),
        gt(operations.createdAt, new Date(now.getTime() - PENDING_FOR_MS)),
      ),
    )
    .orderBy(desc(operations.createdAt));
}
