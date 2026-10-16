import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { AGENT_LOCK, runAgent, saveDecisions } from "../src/lib/agent-runner";
import { decisions, locks } from "../src/lib/db/schema";
import { fakeAgent } from "./support/agent";
import { addLiveFund, addUser, testDb } from "./support/db";
import { ANA, FUND, USDT_UNIT, snapshot } from "./support/fixtures";

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
    await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id] });
    // USDT waiting that the agent can't price: the heartbeat decides "blocked", and saves it.
    const { makeContext } = fakeAgent({ snapshot: () => snapshot({ usdtBalance: 1_000n * USDT_UNIT }) });
    return { db, makeContext };
  }
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
    const { db, makeContext } = await setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = async () => {
      throw new Error("Blockscout answered HTTP 429");
    };
    const run = await runAgent(db, makeContext, { ...options, heartbeat: true, afterHeartbeat: failing });
    expect(run).toMatchObject({ ran: true, decisions: [{ kind: "blocked" }] });
    expect(await db.select().from(decisions)).toHaveLength(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Blockscout answered HTTP 429"));
    logged.mockRestore();
  });
});
