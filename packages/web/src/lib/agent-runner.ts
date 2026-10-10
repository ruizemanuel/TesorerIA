import { type AgentContext, type Decision, handleExpense, runHeartbeat } from "@tesoreria/agent";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { type Address, type Hash, type Hex, getAddress } from "viem";
import type { Db } from "./db/client";
import { withLock } from "./db/lock";
import { type ExpenseStatus, decisions, expenses, funds, users } from "./db/schema";

export const AGENT_LOCK = "agent";
/**
 * The lock keeps others out only until it expires, and nothing renews it, so it must outlive any run: 310 s is
 * above the routes' `maxDuration = 300`, so Vercel stops a run before its lock expires.
 */
export const AGENT_LOCK_TTL_MS = 310_000;

export type MakeContext = (onSent?: AgentContext["onSent"]) => Promise<AgentContext>;
export type TxStatus = (hash: Hash) => Promise<"success" | "reverted" | "pending">;
export type AgentRun = { ran: false } | { ran: true; decisions: Decision[] };

/**
 * An expense's status after the agent's decision on it; `before` is the status the run found it in. A dry run
 * (sending off) decides to reimburse or propose but sends nothing, so its decision has no hash and no status:
 * the expense stays as it was, to be handled for real once sending is on. It is never "sending", which means
 * "sent, receipt unknown".
 */
export function statusAfter(decision: Decision, before: ExpenseStatus): ExpenseStatus {
  if (decision.tx !== undefined) {
    if (decision.status === "reverted") return "blocked";
    if (decision.status === undefined) return "sending"; // sent, receipt unknown: settleSent finishes it
    return decision.kind === "reimburse" ? "reimbursed" : "proposed";
  }
  switch (decision.kind) {
    case "reimburse":
    case "propose-payment":
      return before; // a dry run
    case "wait":
      return "waiting";
    case "reject":
      // A run that died after sending, before keeping the hash: the chain already has this ref.
      return decision.reason.startsWith("Already reimbursed") ? "reimbursed" : "rejected";
    default:
      return "blocked";
  }
}

/** What an expense's transaction did: a reimbursement, or else a payment proposal. */
function sentAction(kind: Decision["kind"]): "reimburse" | "propose-payment" {
  return kind === "reimburse" ? "reimburse" : "propose-payment";
}

/** A decision as a row, its amounts as decimal strings (spec, 8.6). */
async function saveDecisions(db: Db, list: readonly Decision[], expenseId?: string): Promise<void> {
  for (const d of list) {
    const action = d.action === undefined ? null : Object.fromEntries(Object.entries(d.action).map(([k, v]) => [k, String(v)]));
    await db.insert(decisions).values({ fund: d.fund ?? null, expenseId: expenseId ?? null, kind: d.kind, reason: d.reason, action, tx: d.tx ?? null, status: d.status ?? null });
  }
}

/**
 * Settles the expenses a run left in "sending". With a hash, its receipt decides; one that never shows up stays
 * "sending", since nothing is ever sent again on a guess. Without a hash, the run died before sending, or
 * between sending and keeping the hash: it goes back to the queue only once the lock that run held has expired,
 * so a transaction that did go out is mined by then and handleExpense finds its ref.
 */
async function settleSent(db: Db, txStatus: TxStatus): Promise<void> {
  const rows = await db.select().from(expenses).where(eq(expenses.status, "sending"));
  for (const row of rows) {
    if (row.tx === null) {
      if (Date.now() - row.updatedAt.getTime() > AGENT_LOCK_TTL_MS) {
        await db.update(expenses).set({ status: "new", updatedAt: new Date() }).where(eq(expenses.id, row.id));
      }
      continue;
    }
    const status = await txStatus(row.tx as Hash);
    if (status === "pending") continue;
    const settled: ExpenseStatus = status === "reverted" ? "blocked" : row.sentAction === "reimburse" ? "reimbursed" : "proposed";
    await db.update(expenses).set({ status: settled, updatedAt: new Date() }).where(eq(expenses.id, row.id));
  }
}

/** One expense, if it is queued: handed to the agent, and its status and decision kept. */
async function processExpense(db: Db, makeContext: MakeContext, id: string, queued: ExpenseStatus[]): Promise<Decision | null> {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (expense === undefined || !queued.includes(expense.status)) return null;
  // Made before touching the row: a context that can't be made (no key, say) leaves the expense as it was.
  const ctx = await makeContext(async ({ action, tx }) => {
    await db.update(expenses).set({ tx, sentAction: sentAction(action.kind), updatedAt: new Date() }).where(eq(expenses.id, id));
  });
  if (ctx.send) {
    // Claimed only in the status it was read in, in one statement (production's driver has no transactions).
    // A dry run sends nothing, so it has nothing in flight to mark.
    const [claimed] = await db
      .update(expenses)
      .set({ status: "sending", updatedAt: new Date() })
      .where(and(eq(expenses.id, id), eq(expenses.status, expense.status)))
      .returning({ id: expenses.id });
    if (claimed === undefined) return null;
  }
  const [owner] = await db.select({ account: users.account }).from(users).where(eq(users.id, expense.userId));
  const [fund] = await db.select({ address: funds.address }).from(funds).where(eq(funds.id, expense.fundId));
  if (owner === undefined || fund?.address == null) {
    await db.update(expenses).set({ status: "rejected", reason: "No live fund", updatedAt: new Date() }).where(eq(expenses.id, id));
    return null;
  }
  const decision = await handleExpense(ctx, getAddress(fund.address) as Address, {
    member: getAddress(owner.account),
    amount: expense.amount,
    kind: expense.kind,
    ref: expense.ref as Hex,
    note: expense.note,
  });
  // The hash and what it was, again: if onSent couldn't keep them, settleSent still needs both.
  const sent = decision.tx === undefined ? {} : { tx: decision.tx, sentAction: sentAction(decision.kind) };
  await db
    .update(expenses)
    .set({ status: statusAfter(decision, expense.status), reason: decision.reason, ...sent, updatedAt: new Date() })
    .where(eq(expenses.id, id));
  await saveDecisions(db, [decision], id);
  return decision;
}

/**
 * Runs the agent once, under the lock (Review Focus 4): settles what earlier runs sent, handles `expenseId`
 * first, converts on a heartbeat, and then retries the queue (new and waiting; blocked too on a heartbeat),
 * without taking `expenseId` a second time.
 */
export async function runAgent(
  db: Db,
  makeContext: MakeContext,
  { expenseId, heartbeat = false, txStatus }: { expenseId?: string; heartbeat?: boolean; txStatus: TxStatus },
): Promise<AgentRun> {
  const queued: ExpenseStatus[] = heartbeat ? ["new", "waiting", "blocked"] : ["new", "waiting"];
  const result = await withLock(db, AGENT_LOCK, AGENT_LOCK_TTL_MS, async () => {
    const done: Decision[] = [];
    await settleSent(db, txStatus);
    if (expenseId !== undefined) {
      const decision = await processExpense(db, makeContext, expenseId, ["new", "waiting", "blocked"]);
      if (decision) done.push(decision);
    }
    if (heartbeat) {
      const conversions = await runHeartbeat(await makeContext());
      await saveDecisions(db, conversions);
      done.push(...conversions);
    }
    const waiting = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(inArray(expenses.status, queued), expenseId === undefined ? undefined : ne(expenses.id, expenseId)))
      .orderBy(asc(expenses.createdAt))
      .limit(10);
    for (const { id } of waiting) {
      const decision = await processExpense(db, makeContext, id, queued);
      if (decision) done.push(decision);
    }
    return done;
  });
  return result.ran ? { ran: true, decisions: result.value } : { ran: false };
}
