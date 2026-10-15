import { type Hash, getAddress, pad } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_LOCK, type MakeContext } from "../src/lib/agent-runner";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { acquireLock } from "../src/lib/db/lock";
import { finishOperation, recordOperation } from "../src/lib/operations";
import { fakeAgent } from "./support/agent";
import { addLiveFund, addUser, testDb } from "./support/db";
import { ANA, BETO, FUND, USDT_UNIT, snapshot } from "./support/fixtures";

// The routes as the server runs them, with the session, the database, the settings and the agent's chain standing in.
const SECRET = "h".repeat(64);
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  db: null as unknown,
  makeContext: null as unknown,
  secret: undefined as string | undefined,
  contexts: 0,
}));
vi.mock("../src/lib/current-user", () => ({ currentUser: async () => state.user }));
vi.mock("../src/lib/env", () => ({ env: () => ({ HEARTBEAT_SECRET: state.secret }) }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/agent-context", () => ({
  agentContext: (_db: unknown, onSent: Parameters<MakeContext>[0]) => {
    state.contexts += 1;
    return (state.makeContext as MakeContext)(onSent);
  },
  txStatus: async () => "success",
  agentInFlight: async () => false,
}));

const waitForBlock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../src/lib/read-your-writes", () => ({ waitForBlock }));
vi.mock("../src/lib/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/chain")>()),
  celoClient: () => ({}),
}));

const heartbeat = await import("../src/app/api/agent/heartbeat/route");
const run = await import("../src/app/api/agent/run/route");

let db: Db;
let ana: CurrentUser;

const asUser = (user: { id: string; name: string; account: string }): CurrentUser => ({ id: user.id, name: user.name, account: getAddress(user.account) });
const beat = (authorization?: string) =>
  heartbeat.POST(new Request("http://localhost:3000/api/agent/heartbeat", { method: "POST", headers: authorization === undefined ? {} : { authorization } }));
const afterContribution = (headers: Record<string, string> = {}) =>
  run.POST(new Request("http://localhost:3000/api/agent/run", { method: "POST", headers }));
/** An agent that can't be built, as when AGENT_PRIVATE_KEY is not set. */
const noKey: MakeContext = async () => {
  throw new Error("AGENT_PRIVATE_KEY is not set");
};

beforeEach(async () => {
  db = await testDb();
  state.db = db;
  state.secret = SECRET;
  state.contexts = 0;
  ana = asUser(await addUser(db, "Ana", ANA));
  const beto = await addUser(db, "Beto", BETO);
  await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id, beto.id] });
  state.user = ana;
  state.makeContext = fakeAgent({ snapshot: () => snapshot() }).makeContext;
});

describe("POST /api/agent/heartbeat", () => {
  it("answers 401, running nothing, to anything but the exact secret", async () => {
    for (const authorization of [undefined, "", SECRET, `Bearer ${SECRET}x`, "Bearer wrong"]) {
      const response = await beat(authorization);
      expect(response.status, String(authorization)).toBe(401);
      expect(JSON.stringify(await response.json())).not.toContain(SECRET);
    }
    state.secret = undefined;
    expect((await beat("Bearer undefined")).status).toBe(401);
    expect(state.contexts).toBe(0);
  });

  it("runs the agent for the secret, and counts its decisions by kind", async () => {
    const quiet = await beat(`Bearer ${SECRET}`);
    expect(quiet.status).toBe(200);
    expect(await quiet.json()).toEqual({ ran: true, decisions: {} });

    // USDT waiting in the fund: the agent decides about it (here it can't price it, so it is blocked, and says so).
    state.makeContext = fakeAgent({ snapshot: () => snapshot({ usdtBalance: 1_000n * USDT_UNIT }) }).makeContext;
    const busy = await beat(`Bearer ${SECRET}`);
    expect(busy.status).toBe(200);
    expect(await busy.json()).toEqual({ ran: true, decisions: { blocked: 1 } });
  });

  it("answers 202 when another run holds the agent", async () => {
    await acquireLock(db, AGENT_LOCK, "someone else", 60_000);
    const response = await beat(`Bearer ${SECRET}`);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ran: false });
    expect(state.contexts).toBe(0);
  });

  it("answers non-2xx, with the cause only in the log, when the agent can't be built", async () => {
    state.makeContext = noKey;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await beat(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ran: false, reason: "agent unavailable" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("AGENT_PRIVATE_KEY is not set"));
    logged.mockRestore();
  });
});

describe("POST /api/agent/run", () => {
  it("answers 401 without a session and 403 to someone in no live fund, running nothing", async () => {
    state.user = null;
    expect((await afterContribution()).status).toBe(401);
    state.user = asUser(await addUser(db, "Dani"));
    expect((await afterContribution()).status).toBe(403);
    expect(state.contexts).toBe(0);
  });

  it("answers its refusals in the language of the request", async () => {
    const english = { cookie: "lang=en" };
    state.user = null;
    expect(await (await afterContribution(english)).json()).toEqual({ error: "Log in with your passkey." });
    state.user = asUser(await addUser(db, "Dani"));
    expect(await (await afterContribution(english)).json()).toEqual({ error: "You aren't in any fund." });
    expect(await (await afterContribution()).json()).toEqual({ error: "No estás en ningún fondo." });
    state.user = ana;
    expect((await afterContribution(english)).status).toBe(202);
    const again = await afterContribution(english);
    expect(again.status).toBe(429);
    expect(await again.json()).toEqual({ error: "The agent just ran." });
    expect(await (await afterContribution()).json()).toEqual({ error: "El agente acaba de correr." });
  });

  it("runs the agent for a member, and then at most once a minute whoever asks", async () => {
    const first = await afterContribution();
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ ran: true });
    expect(state.contexts).toBe(1);

    const again = await afterContribution();
    expect(again.status).toBe(429);
    expect(state.contexts).toBe(1);
  });

  it("answers 202 without running when another run holds the agent", async () => {
    await acquireLock(db, AGENT_LOCK, "someone else", 60_000);
    const response = await afterContribution();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ran: false });
    expect(state.contexts).toBe(0);
  });

  it("answers 202, with the cause only in the log, when the agent can't be built", async () => {
    state.makeContext = noKey;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await afterContribution();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ran: false, reason: "agent unavailable" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("AGENT_PRIVATE_KEY is not set"));
    logged.mockRestore();
  });

  it("waits for the node to have the member's last operation before running the agent (read-your-writes)", async () => {
    const landed: Hash = pad("0x0c", { size: 32 });
    await recordOperation(db, ana.id, { userOpHash: landed, kind: "contribute", fund: FUND, amount: 5_000_000n, token: "usdt" });
    await finishOperation(db, ana.id, { userOpHash: landed, transactionHash: landed, success: true, block: 79_925_582n });
    waitForBlock.mockClear();
    expect((await afterContribution()).status).toBe(202);
    expect(waitForBlock).toHaveBeenCalledWith(expect.anything(), 79_925_582n);
    expect(state.contexts).toBe(1);
  });
});
