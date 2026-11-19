import { type AgentContext, type Decision, handleExpense, runHeartbeat, shortMessage } from "@tesoreria/agent";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
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
/** Whether the agent has a transaction sent and not yet mined (true when that can't be told). */
export type InFlight = () => Promise<boolean>;
export type AgentRun = { ran: false } | { ran: true; decisions: Decision[] };

/**
 * An expense's status after the agent's decision on it; `before` is the status the run found it in. A dry run
 * (sending off) decides to reimburse or propose but sends nothing, so its decision has no hash and no status:
 * the expense stays as it was, to be handled for real once sending is on. "sending" means "sent, receipt unknown",
 * or "the send threw, so it may be out": without a hash, settleSent requeues it only once nothing of the agent's is
 * unmined, and then the chain's history shows whether it landed (the ref, or the agent's proposal).
 */
export function statusAfter(decision: Decision, before: ExpenseStatus): ExpenseStatus {
  if (decision.sendFailed) return "sending";
  if (decision.tx !== undefined) {
    if (decision.status === "reverted") return "blocked";
    if (decision.status === undefined) return "sending"; // sent, receipt unknown: settleSent finishes it
    return sentAction(decision.kind) === "reimburse" ? "reimbursed" : "proposed";
  }
  switch (decision.kind) {
    case "reimburse":
    case "propose-payment":
    case "propose-give-back":
      return before; // a dry run
    case "wait":
      return decision.code === "proposal-quota" ? "quota" : "waiting";
    case "reject":
      // A run that died after sending, before keeping the hash: the chain already has this ref.
      return decision.reason.startsWith("Already reimbursed") ? "reimbursed" : "rejected";
    // Not an expense's decision, or one that stopped: kept as blocked. Listed one by one, so a new kind of decision is a
    // type error here until it is placed, not a silent "blocked".
    case "convert":
    case "pay-fee":
    case "skip":
    case "blocked":
      return "blocked";
    default:
      return unreachable(decision.kind);
  }
}

/** Fails the typecheck, where it is called, when a union has a member that wasn't handled above it. */
function unreachable(kind: never): never {
  throw new Error(`Unhandled decision kind ${String(kind)}`);
}

/** What an expense's transaction did: a reimbursement, or else a proposal (a give-back's too: it's kept as a payment proposal). */
function sentAction(kind: Decision["kind"]): "reimburse" | "propose-payment" {
  switch (kind) {
    case "reimburse":
      return "reimburse";
    case "propose-payment":
    case "propose-give-back":
      return "propose-payment";
    // Never an expense's transaction (those are the agent's heartbeat), and kept as a proposal, as they always were.
    case "convert":
    case "pay-fee":
    case "skip":
    case "wait":
    case "reject":
    case "blocked":
      return "propose-payment";
    default:
      return unreachable(kind);
  }
}

/** A decision as a row, its amounts as decimal strings (spec, 8.6). */
export async function saveDecisions(db: Db, list: readonly Decision[], expenseId?: string): Promise<void> {
  for (const d of list) {
    const action = d.action === undefined ? null : Object.fromEntries(Object.entries(d.action).map(([k, v]) => [k, String(v)]));
    await db.insert(decisions).values({ fund: d.fund ?? null, expenseId: expenseId ?? null, kind: d.kind, reason: d.reason, code: d.code ?? null, action, tx: d.tx ?? null, status: d.status ?? null });
  }
}

/**
 * Settles the expenses a run left in "sending". With a hash, its receipt decides; one that never shows up stays
 * "sending", since nothing is ever sent again on a guess. Without a hash, the run died before sending, or
 * between sending and keeping the hash, or its send threw (and may have gone out all the same). It goes back to
 * the queue only once the lock that run held has expired and none of the agent's transactions is waiting to be
 * mined: a transaction that did go out is mined by then, and handleExpense finds its ref, or its proposal. (The
 * run may have sent near its end, well after the claim it is timed from.)
 */
async function settleSent(db: Db, txStatus: TxStatus, inFlight: InFlight): Promise<void> {
  const rows = await db.select().from(expenses).where(eq(expenses.status, "sending"));
  let idle: boolean | undefined; // asked once, and only if a row needs it
  for (const row of rows) {
    if (row.tx === null) {
      if (Date.now() - row.updatedAt.getTime() <= AGENT_LOCK_TTL_MS) continue;
      idle ??= !(await inFlight());
      if (idle) await db.update(expenses).set({ status: "new", updatedAt: new Date() }).where(eq(expenses.id, row.id));
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
    // An earlier attempt's hash goes: if this run dies, settleSent must see no hash and wait, not read that one.
    // A dry run sends nothing, so it has nothing in flight to mark.
    const [claimed] = await db
      .update(expenses)
      .set({ status: "sending", tx: null, sentAction: null, updatedAt: new Date() })
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
  // What the fund's other expenses went out in: a proposal in one of those is theirs, even one identical to this
  // expense's, made after it was entered (both waited for the agent's weekly proposals).
  const others = await db
    .select({ tx: expenses.tx })
    .from(expenses)
    .where(and(eq(expenses.fundId, expense.fundId), ne(expenses.id, id), isNotNull(expenses.tx)));
  const claimed = others.flatMap(({ tx }) => (tx === null ? [] : [tx as Hash]));
  const decision = await handleExpense(
    ctx,
    getAddress(fund.address) as Address,
    {
      member: getAddress(owner.account),
      amount: expense.amount,
      kind: expense.kind,
      ref: expense.ref as Hex,
      note: expense.note,
      enteredAt: BigInt(Math.floor(expense.createdAt.getTime() / 1000)),
    },
    claimed,
  );
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
 * first, converts on a heartbeat, and then retries the queue (new, waiting and quota; blocked too on a heartbeat),
 * without taking `expenseId` a second time. The queue takes new expenses first and then the ones tried longest
 * ago: rows that wait for pesos or stay blocked take turns, and never keep a newer expense out.
 *
 * A heartbeat ends with `afterHeartbeat` (the week summaries, spec 9.4), after the queue and still under the lock:
 * a slow summary (an explorer that times out, fund after fund) must never keep a reimbursement waiting, and it
 * runs even if the queue threw. A failure there is logged and cuts nothing.
 */
export async function runAgent(
  db: Db,
  makeContext: MakeContext,
  {
    expenseId,
    heartbeat = false,
    txStatus,
    inFlight,
    afterHeartbeat,
  }: { expenseId?: string; heartbeat?: boolean; txStatus: TxStatus; inFlight: InFlight; afterHeartbeat?: () => Promise<void> },
): Promise<AgentRun> {
  // "quota" is tried again on every run: the week may have turned over, and the agent has its proposals again.
  const queued: ExpenseStatus[] = heartbeat ? ["new", "waiting", "quota", "blocked"] : ["new", "waiting", "quota"];
  const result = await withLock(db, AGENT_LOCK, AGENT_LOCK_TTL_MS, async () => {
    const done: Decision[] = [];
    await settleSent(db, txStatus, inFlight);
    if (expenseId !== undefined) {
      const decision = await processExpense(db, makeContext, expenseId, ["new", "waiting", "quota", "blocked"]);
      if (decision) done.push(decision);
    }
    if (heartbeat) {
      const conversions = await runHeartbeat(await makeContext());
      await saveDecisions(db, conversions);
      done.push(...conversions);
    }
    try {
      const waiting = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(inArray(expenses.status, queued), expenseId === undefined ? undefined : ne(expenses.id, expenseId)))
        // Every attempt sets updatedAt, so the oldest one is the one tried longest ago.
        .orderBy(sql`case when ${expenses.status} = 'new' then 0 else 1 end`, asc(expenses.updatedAt))
        .limit(10);
      for (const { id } of waiting) {
        const decision = await processExpense(db, makeContext, id, queued);
        if (decision) done.push(decision);
      }
    } finally {
      // Last, so a slow summary never delays a reimbursement, and in a `finally`, so a queue that threw (the error
      // goes on up) still gets them. Their failures are their own: logged, and they cut nothing.
      if (heartbeat && afterHeartbeat !== undefined) {
        try {
          await afterHeartbeat();
        } catch (error) {
          console.error(`The heartbeat's week summaries failed: ${shortMessage(error)}`);
        }
      }
    }
    return done;
  });
  return result.ran ? { ran: true, decisions: result.value } : { ran: false };
}
