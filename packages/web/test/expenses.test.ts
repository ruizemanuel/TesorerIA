import { fundAbi } from "@tesoreria/agent";
import { eq } from "drizzle-orm";
import { type Hash, type Hex, decodeFunctionData, pad } from "viem";
import { describe, expect, it } from "vitest";
import { AGENT_LOCK, AGENT_LOCK_TTL_MS, type MakeContext, runAgent } from "../src/lib/agent-runner";
import type { Db } from "../src/lib/db/client";
import { acquireLock, releaseLock } from "../src/lib/db/lock";
import { decisions, expenses } from "../src/lib/db/schema";
import { submitExpense } from "../src/lib/expenses";
import { MAX_PESOS } from "../src/lib/format";
import { SENT_HASH, fakeAgent } from "./support/agent";
import { addLiveFund, addUser, testDb } from "./support/db";
import { ANA, BETO, BLOCK, CARO, FUND, WARS, event, snapshot } from "./support/fixtures";

const always = (status: "success" | "reverted" | "pending") => async () => status;
/** No agent transaction is waiting to be mined. */
const idle = async () => false;

async function setup() {
  const db = await testDb();
  const ana = await addUser(db, "Ana", ANA);
  const beto = await addUser(db, "Beto", BETO);
  const caro = await addUser(db, "Caro", CARO);
  const fund = await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id, beto.id, caro.id] });
  return { db, ana, fund };
}

async function load(db: Db, user: { id: string }, fundId: string, input: Partial<Parameters<typeof submitExpense>[1]["input"]> = {}) {
  const result = await submitExpense(db, {
    userId: user.id,
    fundId,
    input: { clientKey: "k1", kind: "agreed", amount: 45_000n * WARS, note: "la cancha del jueves", ...input },
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function statusOf(db: Db, id: string) {
  const [row] = await db.select().from(expenses).where(eq(expenses.id, id));
  return row!;
}

describe("submitExpense", () => {
  it("keeps one expense per click, whatever the retries", async () => {
    const { db, ana, fund } = await setup();
    const first = await load(db, ana, fund.id);
    const again = await load(db, ana, fund.id, { amount: 99n * WARS });
    expect(again).toEqual({ ok: true, id: first.id, status: "new", created: false });
    expect(await db.select().from(expenses)).toHaveLength(1);
  });

  it("refuses a note longer than the chain takes, an amount of zero, or one beyond any real amount", async () => {
    const { db, ana, fund } = await setup();
    const base = { clientKey: "k", kind: "agreed" as const, amount: 1n * WARS, note: "" };
    expect(await submitExpense(db, { userId: ana.id, fundId: fund.id, input: { ...base, note: "x".repeat(141) } })).toMatchObject({ ok: false, status: 400 });
    expect(await submitExpense(db, { userId: ana.id, fundId: fund.id, input: { ...base, amount: 0n } })).toMatchObject({ ok: false, status: 400 });
    expect(await submitExpense(db, { userId: ana.id, fundId: fund.id, input: { ...base, amount: MAX_PESOS + 1n } })).toMatchObject({ ok: false, status: 400 });
    expect(await db.select().from(expenses)).toEqual([]);
  });

  it("asks before keeping the same expense from another tab within ten minutes, and keeps it once confirmed", async () => {
    const { db, ana, fund } = await setup();
    const first = await load(db, ana, fund.id);
    const twin = await load(db, ana, fund.id, { clientKey: "k2" });
    expect(twin).toEqual({ ok: true, id: first.id, status: "new", created: false, duplicateOf: first.id });
    expect(await db.select().from(expenses)).toHaveLength(1);

    const confirmed = await load(db, ana, fund.id, { clientKey: "k3", confirmDuplicate: true });
    expect(confirmed).toMatchObject({ ok: true, status: "new", created: true });
    expect(confirmed.id).not.toBe(first.id);
    expect(confirmed.duplicateOf).toBeUndefined();

    // Another amount or another kind is another expense: nothing to ask.
    expect(await load(db, ana, fund.id, { clientKey: "k4", amount: 10_000n * WARS })).toMatchObject({ created: true });
    expect(await load(db, ana, fund.id, { clientKey: "k5", kind: "other" })).toMatchObject({ created: true });
    expect(await db.select().from(expenses)).toHaveLength(4);
  });

  it("keeps the same expense again without asking after ten minutes", async () => {
    const { db, ana, fund } = await setup();
    const first = await load(db, ana, fund.id);
    await db.update(expenses).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(expenses.id, first.id));
    const later = await load(db, ana, fund.id, { clientKey: "k2" });
    expect(later).toMatchObject({ ok: true, created: true });
    expect(later.duplicateOf).toBeUndefined();
    expect(await db.select().from(expenses)).toHaveLength(2);
  });
});

describe("runAgent", () => {
  it("pays an agreed expense back once, keeping the hash before the receipt", async () => {
    const { db, ana, fund } = await setup();
    const { id } = await load(db, ana, fund.id);
    const { makeContext, sent } = fakeAgent({ snapshot: () => snapshot() });
    const run = await runAgent(db, makeContext, { expenseId: id, txStatus: always("success"), inFlight: idle });
    expect(run.ran).toBe(true);
    const row = await statusOf(db, id);
    expect(row).toMatchObject({ status: "reimbursed", tx: SENT_HASH, sentAction: "reimburse" });
    const { functionName, args } = decodeFunctionData({ abi: fundAbi, data: sent[0]!.data });
    expect(functionName).toBe("reimburseAgreedExpense");
    expect(args).toEqual([ANA, 45_000n * WARS, row.ref]);
    expect(await db.select().from(decisions).where(eq(decisions.expenseId, id))).toHaveLength(1);
    await runAgent(db, makeContext, { expenseId: id, txStatus: always("success"), inFlight: idle });
    expect(sent).toHaveLength(1);
  });

  it("leaves the expense queued when the agent is busy, and runs one agent at a time", async () => {
    const { db, ana, fund } = await setup();
    const { id } = await load(db, ana, fund.id);
    const { makeContext, sent } = fakeAgent({ snapshot: () => snapshot() });
    await acquireLock(db, AGENT_LOCK, "someone else", 60_000);
    expect(await runAgent(db, makeContext, { expenseId: id, txStatus: always("success"), inFlight: idle })).toEqual({ ran: false });
    expect((await statusOf(db, id)).status).toBe("new");
    expect(sent).toEqual([]);

    const fresh = await setup();
    const both = await Promise.all([
      runAgent(fresh.db, fakeAgent({ snapshot: () => snapshot() }).makeContext, { heartbeat: false, txStatus: always("success"), inFlight: idle }),
      runAgent(fresh.db, fakeAgent({ snapshot: () => snapshot() }).makeContext, { heartbeat: false, txStatus: always("success"), inFlight: idle }),
    ]);
    expect(both.filter((r) => r.ran)).toHaveLength(1);
  });

  it("proposes what isn't the agreed expense, and waits for the pesos when the fund is short", async () => {
    const { db, ana, fund } = await setup();
    const other = await load(db, ana, fund.id, { clientKey: "k2", kind: "other", note: "la pelota nueva" });
    let warsBalance = 10_000n * WARS;
    const { makeContext } = fakeAgent({ snapshot: () => snapshot({ warsBalance }) });
    await runAgent(db, makeContext, { expenseId: other.id, txStatus: always("success"), inFlight: idle });
    expect(await statusOf(db, other.id)).toMatchObject({ status: "proposed", sentAction: "propose-payment" });

    const short = await load(db, ana, fund.id, { clientKey: "k3" });
    await runAgent(db, makeContext, { expenseId: short.id, txStatus: always("success"), inFlight: idle });
    expect((await statusOf(db, short.id)).status).toBe("waiting");
    warsBalance = 90_000n * WARS; // a contribution arrived
    await runAgent(db, makeContext, { txStatus: always("success"), inFlight: idle });
    expect((await statusOf(db, short.id)).status).toBe("reimbursed");
  });

  it("settles a sent transaction whose receipt it couldn't read, on the next run", async () => {
    const { db, ana, fund } = await setup();
    const { id } = await load(db, ana, fund.id);
    const lost = fakeAgent({ snapshot: () => snapshot(), receiptError: new Error("timed out") });
    await runAgent(db, lost.makeContext, { expenseId: id, txStatus: always("pending"), inFlight: idle });
    expect(await statusOf(db, id)).toMatchObject({ status: "sending", tx: SENT_HASH });
    await runAgent(db, lost.makeContext, { txStatus: always("pending"), inFlight: idle });
    expect((await statusOf(db, id)).status).toBe("sending");
    await runAgent(db, lost.makeContext, { txStatus: always("success"), inFlight: idle });
    expect((await statusOf(db, id)).status).toBe("reimbursed");
    expect(lost.sent).toHaveLength(1);
  });

  it("settles a sent reimbursement as one even when keeping its hash failed at first", async () => {
    const { db, ana, fund } = await setup();
    const { id } = await load(db, ana, fund.id);
    const lost = fakeAgent({ snapshot: () => snapshot(), receiptError: new Error("timed out") });
    // The database didn't take the hash as it went out; the decision still carries it.
    const hookFails: MakeContext = () =>
      lost.makeContext(async () => {
        throw new Error("connection reset");
      });
    await runAgent(db, hookFails, { expenseId: id, txStatus: always("pending"), inFlight: idle });
    expect(await statusOf(db, id)).toMatchObject({ status: "sending", tx: SENT_HASH, sentAction: "reimburse", reason: expect.stringContaining("hash not recorded") });
    await runAgent(db, hookFails, { txStatus: always("success"), inFlight: idle });
    expect((await statusOf(db, id)).status).toBe("reimbursed");
    expect(lost.sent).toHaveLength(1);
  });

  it("handles the expense it was called for once per run, even when it stays in the queue", async () => {
    const { db, ana, fund } = await setup();
    const { id } = await load(db, ana, fund.id);
    const { makeContext } = fakeAgent({ snapshot: () => snapshot({ warsBalance: 10_000n * WARS }) });
    const run = await runAgent(db, makeContext, { expenseId: id, txStatus: always("success"), inFlight: idle });
    expect(run).toMatchObject({ ran: true, decisions: [{ kind: "wait" }] });
    expect((await statusOf(db, id)).status).toBe("waiting");
    expect(await db.select().from(decisions).where(eq(decisions.expenseId, id))).toHaveLength(1);
  });

  it("decides but sends nothing while sending is off, and leaves each expense as it was until it's on", async () => {
    const { db, ana, fund } = await setup();
    const agreed = await load(db, ana, fund.id);
    const earlier = await load(db, ana, fund.id, { clientKey: "k2", amount: 10_000n * WARS });
    await db.update(expenses).set({ status: "waiting" }).where(eq(expenses.id, earlier.id)); // it waited for pesos before
    const other = await load(db, ana, fund.id, { clientKey: "k3", kind: "other", note: "la pelota nueva" });

    const off = fakeAgent({ snapshot: () => snapshot(), send: false });
    const dryRun = await runAgent(db, off.makeContext, { expenseId: agreed.id, txStatus: always("success"), inFlight: idle });
    expect(dryRun.ran && dryRun.decisions.map((d) => d.kind).sort()).toEqual(["propose-payment", "reimburse", "reimburse"]);
    expect(off.sent).toEqual([]);
    expect(await statusOf(db, agreed.id)).toMatchObject({ status: "new", tx: null, sentAction: null });
    expect((await statusOf(db, earlier.id)).status).toBe("waiting");
    expect((await statusOf(db, other.id)).status).toBe("new");
    const kept = await db.select().from(decisions);
    expect(kept).toHaveLength(3);
    for (const decision of kept) expect(decision).toMatchObject({ tx: null, reason: expect.stringContaining("dry run") });

    const on = fakeAgent({ snapshot: () => snapshot() });
    await runAgent(db, on.makeContext, { txStatus: always("success"), inFlight: idle });
    expect(await statusOf(db, agreed.id)).toMatchObject({ status: "reimbursed", tx: SENT_HASH });
    expect((await statusOf(db, earlier.id)).status).toBe("reimbursed");
    expect((await statusOf(db, other.id)).status).toBe("proposed");
    expect(on.sent).toHaveLength(3);
  });

  it("never pays twice after a run that died between sending and keeping the hash", async () => {
    const { db, ana, fund } = await setup();
    const { id } = await load(db, ana, fund.id);
    // The run that died had claimed it and sent the reimbursement, which isn't mined yet.
    await db.update(expenses).set({ status: "sending" }).where(eq(expenses.id, id));
    const { ref } = await statusOf(db, id);
    const paid = event("Reimbursement", { member: ANA, amount: 45_000n * WARS, ref: ref as Hex, week: 2n }, BLOCK - 10n);
    let mined = false;
    const { makeContext, sent } = fakeAgent({
      snapshot: () => snapshot({ spentThisWeek: mined ? 45_000n * WARS : 0n }),
      events: () => (mined ? [paid] : []),
    });
    const inFlight = async () => !mined;

    // While that run's lock could still be held, the expense is left alone.
    await runAgent(db, makeContext, { txStatus: always("success"), inFlight });
    expect(await statusOf(db, id)).toMatchObject({ status: "sending", tx: null });

    // The lock ran out, but the agent still has a transaction waiting to be mined: still left alone.
    await db.update(expenses).set({ updatedAt: new Date(Date.now() - AGENT_LOCK_TTL_MS - 1_000) }).where(eq(expenses.id, id));
    await runAgent(db, makeContext, { txStatus: always("success"), inFlight });
    expect(await statusOf(db, id)).toMatchObject({ status: "sending", tx: null });
    expect(sent).toEqual([]);

    // Mined, so nothing is in flight: back to the queue, where the agent finds the ref on chain and sends nothing.
    mined = true;
    await runAgent(db, makeContext, { txStatus: always("success"), inFlight });
    expect((await statusOf(db, id)).status).toBe("reimbursed");
    expect(sent).toEqual([]);
  });

  it("takes an expense loaded while the agent was busy on the next run, however many wait before it", async () => {
    const { db, ana, fund } = await setup();
    const { makeContext } = fakeAgent({ snapshot: () => snapshot({ warsBalance: 1_000n * WARS }) });
    // Eleven earlier expenses, waiting for pesos the fund doesn't have: more than one run takes.
    const stuck: string[] = [];
    for (let i = 0n; i < 11n; i++) {
      const { id } = await load(db, ana, fund.id, { clientKey: `old-${i}`, amount: (50_000n + i) * WARS });
      await db.update(expenses).set({ status: "waiting" }).where(eq(expenses.id, id));
      stuck.push(id);
    }
    await acquireLock(db, AGENT_LOCK, "someone else", 60_000);
    const late = await load(db, ana, fund.id, { amount: 500n * WARS });
    expect(await runAgent(db, makeContext, { expenseId: late.id, txStatus: always("success"), inFlight: idle })).toEqual({ ran: false });
    await releaseLock(db, AGENT_LOCK, "someone else");

    await runAgent(db, makeContext, { txStatus: always("success"), inFlight: idle });
    expect((await statusOf(db, late.id)).status).toBe("reimbursed");
    // The waiting ones take turns: by the next run, each has been looked at again.
    await runAgent(db, makeContext, { txStatus: always("success"), inFlight: idle });
    const looked = new Set((await db.select({ id: decisions.expenseId }).from(decisions)).map((d) => d.id));
    expect(stuck.filter((id) => !looked.has(id))).toEqual([]);
  });

  it("blocks an expense whose transaction reverted, whether the receipt says so at once or on a later run", async () => {
    const { db, ana, fund } = await setup();
    const { id } = await load(db, ana, fund.id);
    const reverting = fakeAgent({ snapshot: () => snapshot(), receipt: "reverted" });
    const run = await runAgent(db, reverting.makeContext, { expenseId: id, txStatus: always("success"), inFlight: idle });
    expect(run).toMatchObject({ ran: true, decisions: [{ kind: "reimburse", tx: SENT_HASH, status: "reverted" }] });
    expect(await statusOf(db, id)).toMatchObject({ status: "blocked", tx: SENT_HASH, sentAction: "reimburse" });

    const later = await load(db, ana, fund.id, { clientKey: "k2", amount: 10_000n * WARS });
    const lost = fakeAgent({ snapshot: () => snapshot(), receiptError: new Error("timed out") });
    await runAgent(db, lost.makeContext, { expenseId: later.id, txStatus: always("pending"), inFlight: idle });
    expect((await statusOf(db, later.id)).status).toBe("sending");
    await runAgent(db, lost.makeContext, { txStatus: always("reverted"), inFlight: idle });
    expect(await statusOf(db, later.id)).toMatchObject({ status: "blocked", tx: SENT_HASH });
  });

  it("forgets an earlier attempt's hash when it takes the expense again", async () => {
    const { db, ana, fund } = await setup();
    const { id } = await load(db, ana, fund.id);
    const reverted: Hash = pad("0x0bad", { size: 32 });
    await db.update(expenses).set({ status: "blocked", tx: reverted, sentAction: "reimburse" }).where(eq(expenses.id, id));
    const agent = fakeAgent({ snapshot: () => snapshot() });
    // The row as the agent works on it: what a run that died right there would leave for settleSent.
    let during: Awaited<ReturnType<typeof statusOf>> | undefined;
    const watching: MakeContext = async (onSent) => {
      const ctx = await agent.makeContext(onSent);
      const gasBalance = async () => {
        during = await statusOf(db, id);
        return ctx.chain.gasBalance();
      };
      return { ...ctx, chain: { ...ctx.chain, gasBalance } };
    };
    await runAgent(db, watching, { expenseId: id, txStatus: always("success"), inFlight: idle });
    expect(during).toMatchObject({ status: "sending", tx: null, sentAction: null });
    expect(await statusOf(db, id)).toMatchObject({ status: "reimbursed", tx: SENT_HASH });
  });
});
