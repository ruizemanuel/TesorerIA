import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_LOCK, type MakeContext } from "../src/lib/agent-runner";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { acquireLock } from "../src/lib/db/lock";
import { expenses } from "../src/lib/db/schema";
import { fakeAgent } from "./support/agent";
import { addLiveFund, addUser, testDb } from "./support/db";
import { ANA, BETO, FUND, snapshot } from "./support/fixtures";

// The route as the server runs it, with the session, the database and the agent's chain standing in.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null, db: null as unknown, makeContext: null as unknown }));
vi.mock("../src/lib/current-user", () => ({ currentUser: async () => state.user }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/agent-context", () => ({
  agentContext: (_db: unknown, onSent: Parameters<MakeContext>[0]) => (state.makeContext as MakeContext)(onSent),
  txStatus: async () => "success",
}));

const { POST } = await import("../src/app/api/funds/[address]/expenses/route");

let db: Db;
let ana: CurrentUser;
let sent: unknown[];

const asUser = (user: { id: string; name: string; account: string }): CurrentUser => ({ id: user.id, name: user.name, account: getAddress(user.account) });
const expense = (body: Record<string, unknown> = {}) =>
  POST(
    new Request(`http://localhost:3000/api/funds/${FUND}/expenses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: "k1", kind: "agreed", amount: "45.000", note: "la cancha", ...body }),
    }),
    { params: Promise.resolve({ address: FUND }) },
  );

beforeEach(async () => {
  db = await testDb();
  state.db = db;
  ana = asUser(await addUser(db, "Ana", ANA));
  const beto = await addUser(db, "Beto", BETO);
  await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id, beto.id] });
  state.user = ana;
  const agent = fakeAgent({ snapshot: () => snapshot() });
  state.makeContext = agent.makeContext;
  sent = agent.sent;
});

describe("POST /api/funds/:address/expenses", () => {
  it("answers 401 without a session, 404 outside the fund, and teaches how to write the amount", async () => {
    state.user = null;
    expect((await expense()).status).toBe(401);
    state.user = asUser(await addUser(db, "Dani"));
    expect((await expense()).status).toBe(404);
    state.user = ana;
    const unclear = await expense({ amount: "45,000.50" });
    expect(unclear.status).toBe(400);
    expect(await unclear.json()).toEqual({ error: "No entendimos el monto. Escribilo como 10.000 o 10.000,50." });
    expect(await db.select().from(expenses)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("answers a retry with the first call's state, keeping one expense and one reimbursement", async () => {
    const first = await expense();
    expect(await first.json()).toEqual({ status: "reimbursed", busy: false });
    const retry = await expense();
    expect(await retry.json()).toEqual({ status: "reimbursed", busy: false });
    expect(await db.select().from(expenses)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("asks before keeping the same expense from another tab, and runs nothing until it is confirmed", async () => {
    await expense();
    const [first] = await db.select().from(expenses);
    expect(await (await expense({ clientKey: "k2" })).json()).toEqual({ status: "reimbursed", duplicateOf: first!.id });
    expect(await db.select().from(expenses)).toHaveLength(1);
    expect(sent).toHaveLength(1);

    expect(await (await expense({ clientKey: "k3", confirmDuplicate: true })).json()).toEqual({ status: "reimbursed", busy: false });
    expect(await db.select().from(expenses)).toHaveLength(2);
    expect(sent).toHaveLength(2);
  });

  it("keeps the expense queued when the agent is busy or can't run, and says so", async () => {
    await acquireLock(db, AGENT_LOCK, "someone else", 60_000);
    expect(await (await expense()).json()).toEqual({ status: "new", busy: true });
    expect(sent).toEqual([]);

    const fresh = await testDb();
    state.db = fresh;
    state.user = asUser(await addUser(fresh, "Ana", ANA));
    await addLiveFund(fresh, { creatorId: state.user.id, address: FUND, members: [state.user.id] });
    state.makeContext = async () => {
      throw new Error("AGENT_PRIVATE_KEY is not set");
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await expense();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "new", busy: true });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("AGENT_PRIVATE_KEY is not set"));
    logged.mockRestore();
    expect(await fresh.select().from(expenses)).toMatchObject([{ status: "new", tx: null }]);
  });
});
