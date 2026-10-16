import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { AGENT_LOCK, runAgent, saveDecisions } from "../src/lib/agent-runner";
import { decisions, expenses, locks } from "../src/lib/db/schema";
import { submitExpense } from "../src/lib/expenses";
import { es } from "../src/lib/i18n/es";
import { fakeAgent } from "./support/agent";
import { addLiveFund, addUser, testDb } from "./support/db";
import { ANA, FUND, USDT_UNIT, WARS, snapshot } from "./support/fixtures";

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
    const { makeContext } = fakeAgent({ snapshot: () => snapshot({ usdtBalance: 1_000n * USDT_UNIT }) });
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
