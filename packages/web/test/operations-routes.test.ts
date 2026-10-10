import { type Hash, getAddress, pad } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { funds, operations } from "../src/lib/db/schema";
import { PENDING_FOR_MS } from "../src/lib/operations";
import { addUser, testDb } from "./support/db";

// The routes as the server runs them, with the session and the database standing in.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null, db: null as unknown }));
vi.mock("../src/lib/current-user", () => ({ currentUser: async () => state.user }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));

const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const OP: Hash = pad("0x01", { size: 32 });
const TX: Hash = pad("0x02", { size: 32 });

let db: Db;
let record: (request: Request) => Promise<Response>;
let finish: (request: Request) => Promise<Response>;
let ana: CurrentUser;
let juan: CurrentUser;
let draftId: string;

const post = (path: string, body: unknown) =>
  new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const asUser = (user: { id: string; name: string; account: string }): CurrentUser => ({ id: user.id, name: user.name, account: getAddress(user.account) });

beforeAll(async () => {
  vi.stubEnv("CHAIN_MODE", "fork");
  vi.stubEnv("RP_ID", "localhost");
  vi.stubEnv("ORIGIN", "http://localhost:3000");
  vi.stubEnv("SESSION_SECRET", "a-session-secret-for-tests-only-0123456789");
  db = await testDb();
  state.db = db;
  ana = asUser(await addUser(db, "Ana"));
  juan = asUser(await addUser(db, "Juan"));
  const [draft] = await db
    .insert(funds)
    .values({ name: "Draft", agreedExpense: "x", weeklyFee: 1n, weeklyCap: 1n, balanceCap: 1n, creatorId: ana.id, inviteCode: "draft-code" })
    .returning();
  draftId = draft!.id;
  ({ POST: record } = await import("../src/app/api/operations/route"));
  ({ POST: finish } = await import("../src/app/api/operations/done/route"));
});
beforeEach(async () => {
  state.user = ana;
  await db.delete(operations);
});

describe("POST /api/operations", () => {
  it("answers 401 to someone who is not logged in", async () => {
    state.user = null;
    expect((await record(post("/api/operations", { userOpHash: OP, kind: "vote", fund: FUND }))).status).toBe(401);
    expect((await finish(post("/api/operations/done", { userOpHash: OP, transactionHash: TX, success: true }))).status).toBe(401);
    expect(await db.select().from(operations)).toEqual([]);
  });

  it("keeps a contribution with its amount, and the fund in the form the database keeps", async () => {
    const response = await record(post("/api/operations", { userOpHash: OP, kind: "contribute", fund: FUND.toLowerCase(), amount: "10000000", token: "usdt" }));
    expect(response.status).toBe(200);
    expect(await db.select().from(operations)).toMatchObject([
      { userOpHash: OP, userId: ana.id, kind: "contribute", fund: FUND, amount: 10_000_000n, token: "usdt", draftId: null },
    ]);
  });

  it("keeps the draft a create-fund deploys, only if it is the caller's", async () => {
    expect((await record(post("/api/operations", { userOpHash: OP, kind: "create-fund", draftId }))).status).toBe(200);
    expect(await db.select().from(operations)).toMatchObject([{ userOpHash: OP, kind: "create-fund", draftId }]);

    state.user = juan; // a member of the group, not its creator
    const other: Hash = pad("0x03", { size: 32 });
    expect((await record(post("/api/operations", { userOpHash: other, kind: "create-fund", draftId }))).status).toBe(403);
    expect(await db.select().from(operations)).toHaveLength(1);
  });

  it("answers 400 to anything malformed, or to a draft on an operation that deploys nothing", async () => {
    const bad = [
      { userOpHash: "0x01", kind: "vote" },
      { userOpHash: OP, kind: "send-everything" },
      { userOpHash: OP, kind: "vote", fund: "0x1234" },
      { userOpHash: OP, kind: "contribute", amount: "-5" },
      { userOpHash: OP, kind: "contribute", amount: "1".repeat(79) },
      { userOpHash: OP, kind: "create-fund", draftId: "not a uuid" },
      { userOpHash: OP, kind: "vote", draftId },
    ];
    for (const body of bad) expect((await record(post("/api/operations", body))).status, JSON.stringify(body)).toBe(400);
    expect(await db.select().from(operations)).toEqual([]);
  });
});

describe("POST /api/operations/done", () => {
  it("settles the caller's own operation and nobody else's", async () => {
    await record(post("/api/operations", { userOpHash: OP, kind: "vote", fund: FUND }));
    state.user = juan;
    expect((await finish(post("/api/operations/done", { userOpHash: OP, transactionHash: TX, success: true }))).status).toBe(200);
    expect(await db.select().from(operations)).toMatchObject([{ transactionHash: null, success: null }]);
    state.user = ana;
    expect((await finish(post("/api/operations/done", { userOpHash: OP, transactionHash: TX, success: true }))).status).toBe(200);
    expect(await db.select().from(operations)).toMatchObject([{ transactionHash: TX, success: true }]);
  });

  it("takes the caller's operation as dropped only once it's older than PENDING_FOR_MS", async () => {
    await record(post("/api/operations", { userOpHash: OP, kind: "vote", fund: FUND }));
    const dropped = async () => (await (await finish(post("/api/operations/done", { userOpHash: OP, dropped: true }))).json()) as unknown;
    expect(await dropped()).toEqual({ ok: true, dropped: false });
    await db.update(operations).set({ createdAt: new Date(Date.now() - PENDING_FOR_MS - 60_000) });
    state.user = juan;
    expect(await dropped()).toEqual({ ok: true, dropped: false });
    state.user = ana;
    expect(await dropped()).toEqual({ ok: true, dropped: true });
    expect(await db.select().from(operations)).toMatchObject([{ transactionHash: null, success: false }]);
  });

  it("answers 400 to a receipt that is not a pair of hashes and a verdict", async () => {
    for (const body of [{ userOpHash: OP, transactionHash: "0x02", success: true }, { userOpHash: OP, transactionHash: TX, success: "yes" }, { userOpHash: OP, dropped: false }, {}]) {
      expect((await finish(post("/api/operations/done", body))).status, JSON.stringify(body)).toBe(400);
    }
  });
});
