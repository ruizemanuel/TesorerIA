import { randomUUID } from "node:crypto";
import { MAX_NOTE_LENGTH } from "@tesoreria/agent";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { keccak256, toHex } from "viem";
import type { Db } from "./db/client";
import { type ExpenseStatus, expenses } from "./db/schema";
import { MAX_PESOS, formatPesos } from "./format";
import type { Messages } from "./i18n/messages";

export type ExpenseInput = {
  clientKey: string;
  kind: "agreed" | "other";
  amount: bigint;
  note: string;
  /** The person said it is another expense, equal to one they loaded a moment ago: keep it anyway. */
  confirmDuplicate?: boolean;
};

export type SubmitResult =
  | { ok: true; id: string; status: ExpenseStatus; created: boolean; duplicateOf?: string }
  | { ok: false; status: number; error: string };

/** Within this long, the same kind and amount from the same person in the same fund is asked about first. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

/**
 * Keeps an expense a member entered (spec, 9, pantalla 6). The same person and client key always give the same
 * row (Review Focus 3); the ref that goes on chain is keccak256 of the row's id.
 *
 * Another tab or a reopened panel makes another client key. So the same kind and amount from the same person in
 * the same fund within DUPLICATE_WINDOW_MS returns that earlier row, flagged `duplicateOf`, and keeps nothing,
 * unless the person confirmed it is another expense (`confirmDuplicate`).
 */
export async function submitExpense(
  db: Db,
  { userId, fundId, input, m }: { userId: string; fundId: string; input: ExpenseInput; m: Messages },
): Promise<SubmitResult> {
  const note = input.note.trim();
  if (input.amount <= 0n) return { ok: false, status: 400, error: m.expenses.amountZero };
  if (input.amount > MAX_PESOS) return { ok: false, status: 400, error: m.expenses.amountTooBig(formatPesos(MAX_PESOS, m.locale)) };
  if ([...note].length > MAX_NOTE_LENGTH) return { ok: false, status: 400, error: m.expenses.noteTooLong(MAX_NOTE_LENGTH) };
  if (input.clientKey.length < 1 || input.clientKey.length > 64) return { ok: false, status: 400, error: m.errors.failed };

  const sameKey = and(eq(expenses.userId, userId), eq(expenses.clientKey, input.clientKey));
  const [retried] = await db.select({ id: expenses.id, status: expenses.status }).from(expenses).where(sameKey);
  if (retried !== undefined) return { ok: true, ...retried, created: false };

  if (input.confirmDuplicate !== true) {
    const [twin] = await db
      .select({ id: expenses.id, status: expenses.status })
      .from(expenses)
      .where(
        and(
          eq(expenses.userId, userId),
          eq(expenses.fundId, fundId),
          eq(expenses.kind, input.kind),
          eq(expenses.amount, input.amount),
          // On the database's clock, the one that wrote createdAt.
          gt(expenses.createdAt, sql`now() - ${DUPLICATE_WINDOW_MS} * interval '1 millisecond'`),
        ),
      )
      .orderBy(desc(expenses.createdAt))
      .limit(1);
    if (twin !== undefined) return { ok: true, ...twin, created: false, duplicateOf: twin.id };
  }

  const id = randomUUID();
  const [row] = await db
    .insert(expenses)
    .values({ id, fundId, userId, clientKey: input.clientKey, kind: input.kind, amount: input.amount, note, ref: keccak256(toHex(id)) })
    .onConflictDoNothing({ target: [expenses.userId, expenses.clientKey] })
    .returning({ id: expenses.id, status: expenses.status });
  if (row !== undefined) return { ok: true, ...row, created: true };
  // Two requests with the same key at once: the other one kept it.
  const [existing] = await db.select({ id: expenses.id, status: expenses.status }).from(expenses).where(sameKey);
  return { ok: true, ...existing!, created: false };
}
