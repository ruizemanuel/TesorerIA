import { fundV2Abi } from "@tesoreria/agent";
import { eq } from "drizzle-orm";
import { decodeFunctionData, zeroAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { AGENT_LOCK, runAgent, saveDecisions, statusAfter } from "../src/lib/agent-runner";
import { decisions, expenses, locks } from "../src/lib/db/schema";
import { submitExpense } from "../src/lib/expenses";
import { SENT_HASH, fakeAgent } from "./support/agent";
import { addLiveFund, addUser, testDb } from "./support/db";
import { AGENT, ANA, BLOCK, FUND, USDT_UNIT, WARS, event, snapshot } from "./support/fixtures";
import { es } from "./support/messages";

describe("saveDecisions", () => {
  it("keeps a skipped conversion's code, and none for a decision without one", async () => {
    const db = await testDb();
    await saveDecisions(db, [
      { fund: FUND, kind: "skip", code: "price-reference", reason: "Chainlink's USD / ARS is 30.0 hours old (26 at most)" },
      { fund: FUND, kind: "blocked", reason: "Could not run the fund: timeout" },
    ]);
    const rows = await db.select().from(decisions).orderBy(decisions.id);
    expect(rows.map(({ kind, code }) => ({ kind, code }))).toEqual([
      { kind: "skip", code: "price-reference" },
      { kind: "blocked", code: null },
    ]);
  });
});

describe("runAgent: the week summaries (spec, 9.4)", () => {
  async function setup() {
    const db = await testDb();
    const ana = await addUser(db, "Ana", ANA);
    const fund = await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id] });
    // USDT waiting that the agent can't price: the heartbeat decides "blocked", and saves it.
    const { makeContext } = fakeAgent({ snapshot: () => snapshot({ dollarBalance: 1_000n * USDT_UNIT }) });
    return { db, makeContext, ana, fundId: fund.id };
  }
  /** An agreed expense waiting for the agent: the queue's work, which the summaries must never delay. */
  async function queueExpense(db: Awaited<ReturnType<typeof testDb>>, userId: string, fundId: string) {
    const result = await submitExpense(db, { userId, fundId, input: { clientKey: "k1", kind: "agreed", amount: 45_000n * WARS, note: "la cancha del jueves" }, m: es });
    if (!result.ok) throw new Error(result.error);
    return result.id;
  }
  const statusOf = async (db: Awaited<ReturnType<typeof testDb>>, id: string) => (await db.select().from(expenses).where(eq(expenses.id, id)))[0]!.status;
  const options = { txStatus: async () => "success" as const, inFlight: async () => false };

  it("writes them on a heartbeat, after its conversions and under its lock, and never on a run that isn't a heartbeat (an expense run)", async () => {
    const { db, makeContext } = await setup();
    const seen: { locked: boolean; decisions: number }[] = [];
    const afterHeartbeat = async () => {
      const held = await db.select().from(locks).where(eq(locks.name, AGENT_LOCK));
      seen.push({ locked: held.length === 1, decisions: (await db.select().from(decisions)).length });
    };
    await runAgent(db, makeContext, { ...options, afterHeartbeat });
    expect(seen).toEqual([]);
    await runAgent(db, makeContext, { ...options, heartbeat: true, afterHeartbeat });
    expect(seen).toEqual([{ locked: true, decisions: 1 }]);
  });

  it("keeps the heartbeat's conversions, and answers its run, when the summaries fail", async () => {
    const { db, makeContext, ana, fundId } = await setup();
    const id = await queueExpense(db, ana.id, fundId);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = async () => {
      throw new Error("Blockscout answered HTTP 429");
    };
    const run = await runAgent(db, makeContext, { ...options, heartbeat: true, afterHeartbeat: failing });
    // The conversion and the queued expense both count, and both are saved.
    expect(run).toMatchObject({ ran: true, decisions: [{ kind: "blocked" }, { kind: "reimburse" }] });
    expect(await db.select().from(decisions)).toHaveLength(2);
    expect(await statusOf(db, id)).toBe("reimbursed");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Blockscout answered HTTP 429"));
    logged.mockRestore();
  });

  it("handles the queued expenses before the summaries start, so a slow summary can't delay a reimbursement", async () => {
    const { db, makeContext, ana, fundId } = await setup();
    const id = await queueExpense(db, ana.id, fundId);
    let statusWhenStarted: string | undefined;
    const slow = async () => {
      statusWhenStarted = await statusOf(db, id);
    };
    await runAgent(db, makeContext, { ...options, heartbeat: true, afterHeartbeat: slow });
    expect(statusWhenStarted).toBe("reimbursed");
  });

  it("still writes the summaries, and still fails the run, when the queue itself throws", async () => {
    const { db, makeContext, ana, fundId } = await setup();
    await queueExpense(db, ana.id, fundId);
    let contexts = 0;
    // The heartbeat's context is made; the expense's is not.
    const broken: typeof makeContext = (onSent) => {
      contexts += 1;
      if (contexts > 1) return Promise.reject(new Error("no key"));
      return makeContext(onSent);
    };
    let wrote = false;
    const afterHeartbeat = async () => {
      wrote = true;
    };
    await expect(runAgent(db, broken, { ...options, heartbeat: true, afterHeartbeat })).rejects.toThrow("no key");
    expect(wrote).toBe(true);
  });
});

describe("runAgent: the agent's weekly proposals and the give-backs of a v2 fund", () => {
  async function setup() {
    const db = await testDb();
    const ana = await addUser(db, "Ana", ANA);
    const fund = await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id] });
    const load = async (input: { clientKey: string; kind: "agreed" | "other" | "give-back"; amount: bigint; note: string; confirmDuplicate?: boolean }) => {
      const result = await submitExpense(db, { userId: ana.id, fundId: fund.id, input, m: es });
      if (!result.ok) throw new Error(result.error);
      return result.id;
    };
    return { db, load };
  }
  const statusOf = async (db: Awaited<ReturnType<typeof testDb>>, id: string) => (await db.select().from(expenses).where(eq(expenses.id, id)))[0]!;
  const options = { txStatus: async () => "success" as const, inFlight: async () => false };
  /** A v2 fund in which the agent has made `proposals` of its 10 proposals of the week. */
  const v2 = (proposals: bigint) => snapshot({ version: 2, feeBps: 25, agentProposalsThisWeek: proposals });

  it("keeps an expense waiting for next week's proposals and tries it again", async () => {
    const { db, load } = await setup();
    const id = await load({ clientKey: "k1", kind: "other", amount: 5_000n * WARS, note: "la pelota nueva" });
    let proposals = 10n;
    const { makeContext, sent } = fakeAgent({ snapshot: () => v2(proposals) });

    const first = await runAgent(db, makeContext, { ...options, expenseId: id });
    expect(first).toMatchObject({ ran: true, decisions: [{ kind: "wait", code: "proposal-quota" }] });
    expect(await statusOf(db, id)).toMatchObject({ status: "quota", tx: null, sentAction: null });
    expect(await db.select().from(decisions).where(eq(decisions.expenseId, id))).toMatchObject([{ kind: "wait", code: "proposal-quota" }]);
    expect(sent).toEqual([]);

    // Every run tries it again, a heartbeat or not, and while there is no place it stays where it was.
    await runAgent(db, makeContext, options);
    await runAgent(db, makeContext, { ...options, heartbeat: true });
    expect((await statusOf(db, id)).status).toBe("quota");
    expect(await db.select().from(decisions).where(eq(decisions.expenseId, id))).toHaveLength(3);
    expect(sent).toEqual([]);

    // The week turned over and the contract's count started again: it's proposed.
    proposals = 0n;
    await runAgent(db, makeContext, options);
    expect(await statusOf(db, id)).toMatchObject({ status: "proposed", tx: SENT_HASH, sentAction: "propose-payment" });
    expect(sent).toHaveLength(1);
  });

  it("proposes each of two identical expenses that waited for next week, not one for both", async () => {
    const { db, load } = await setup();
    const input = { kind: "other", amount: 5_000n * WARS, note: "la pelota nueva" } as const;
    // Two balls bought: the second is entered as the duplicate it looks like, and the member confirms it.
    const first = await load({ clientKey: "k1", ...input });
    const second = await load({ clientKey: "k2", ...input, confirmDuplicate: true });
    expect(second).not.toBe(first);
    let proposals = 10n;
    // Once one is proposed, the history has that proposal, in the transaction the runner recorded on its expense.
    const sentProposal = () => event("ProposalCreated", { id: 0n, action: 0, a: ANA, b: zeroAddress, amount: input.amount, proposer: AGENT, note: input.note }, BLOCK, 0x7a);
    const { makeContext, sent } = fakeAgent({ snapshot: () => v2(proposals), events: () => (sent.length === 0 ? [] : [sentProposal()]) });
    expect(sentProposal().transactionHash).toBe(SENT_HASH);
    await runAgent(db, makeContext, options);
    expect([(await statusOf(db, first)).status, (await statusOf(db, second)).status]).toEqual(["quota", "quota"]);

    // The week turned over: each gets a proposal of its own, not the first's for both (the fake answers every send with SENT_HASH).
    proposals = 0n;
    const run = await runAgent(db, makeContext, options);
    const proposedNow = { kind: "propose-payment", reason: "Only the agreed expense is paid back without a vote", tx: SENT_HASH };
    expect(run).toMatchObject({ ran: true, decisions: [proposedNow, proposedNow] });
    expect(sent).toHaveLength(2);
    for (const id of [first, second]) expect(await statusOf(db, id)).toMatchObject({ status: "proposed", tx: SENT_HASH, sentAction: "propose-payment" });
  });

  it("proposes a give-back in a v2 fund as a GiveBack, and keeps it as a proposal", async () => {
    const { db, load } = await setup();
    const id = await load({ clientKey: "k1", kind: "give-back", amount: 10_000n * WARS, note: "deposité en otro fondo" });
    const { makeContext, sent } = fakeAgent({ snapshot: () => v2(0n) });
    await runAgent(db, makeContext, { ...options, expenseId: id });
    expect(await statusOf(db, id)).toMatchObject({ status: "proposed", tx: SENT_HASH, sentAction: "propose-payment" });
    expect(decodeFunctionData({ abi: fundV2Abi, data: sent[0]?.data ?? "0x" })).toEqual({
      functionName: "propose",
      args: [8, ANA, zeroAddress, 10_000n * WARS, "deposité en otro fondo"],
    });
  });

  it("leaves each kind of expense as it was on a dry run, and tells a wait for the quota from a wait for pesos", () => {
    for (const before of ["new", "waiting", "quota", "blocked"] as const) {
      expect(statusAfter({ kind: "propose-give-back", reason: "dry run" }, before)).toBe(before);
      expect(statusAfter({ kind: "propose-payment", reason: "dry run" }, before)).toBe(before);
    }
    expect(statusAfter({ kind: "propose-give-back", reason: "r", tx: SENT_HASH, status: "success" }, "new")).toBe("proposed");
    expect(statusAfter({ kind: "propose-give-back", reason: "r", tx: SENT_HASH, status: "reverted" }, "new")).toBe("blocked");
    expect(statusAfter({ kind: "wait", reason: "r", code: "proposal-quota" }, "new")).toBe("quota");
    expect(statusAfter({ kind: "wait", reason: "The fund doesn't hold enough wARS yet" }, "quota")).toBe("waiting");
    // What isn't an expense's decision is blocked, each kind by name.
    for (const kind of ["convert", "pay-fee", "skip", "blocked"] as const) expect(statusAfter({ kind, reason: "r" }, "new")).toBe("blocked");
  });
});
