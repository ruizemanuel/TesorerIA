import { eq, sql } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { beforeEach, describe, expect, it } from "vitest";
import { CHAT_RESERVE_LOCK, recordChatUsage, reserveChatMessage } from "../src/lib/chat/quota";
import type { Db } from "../src/lib/db/client";
import * as schema from "../src/lib/db/schema";
import { chatMessages } from "../src/lib/db/schema";
import { addLiveFund, addUser, randomAccount, testDb } from "./support/db";

let db: Db;
let ana: { id: string };
let beto: { id: string };
let fundId: string;

beforeEach(async () => {
  db = await testDb();
  ana = await addUser(db, "Ana");
  beto = await addUser(db, "Beto");
  fundId = (await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id, beto.id] })).id;
});

const reserve = (userId: string, memberLimit = 3, globalLimit = 100) => reserveChatMessage(db, { userId, fundId, memberLimit, globalLimit });

describe("reserveChatMessage: the chat's daily caps (spec, 8.2)", () => {
  it("keeps one row per message and says how many the member has left, until their cap", async () => {
    expect(await reserve(ana.id)).toMatchObject({ ok: true, remaining: 2 });
    expect(await reserve(ana.id)).toMatchObject({ ok: true, remaining: 1 });
    expect(await reserve(ana.id)).toMatchObject({ ok: true, remaining: 0 });
    expect(await reserve(ana.id)).toEqual({ ok: false, limit: "member" });
    expect(await db.select().from(chatMessages)).toHaveLength(3);
    // Beto's cap is his own.
    expect(await reserve(beto.id)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("counts a member's messages in every fund they're in", async () => {
    const other = (await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id, beto.id] })).id;
    await reserveChatMessage(db, { userId: ana.id, fundId: other, memberLimit: 2, globalLimit: 100 });
    expect(await reserve(ana.id, 2)).toMatchObject({ ok: true, remaining: 0 });
    expect(await reserve(ana.id, 2)).toEqual({ ok: false, limit: "member" });
  });

  it("stops everyone at the global cap, and says which cap it was", async () => {
    expect(await reserve(ana.id, 30, 2)).toMatchObject({ ok: true });
    expect(await reserve(beto.id, 30, 2)).toMatchObject({ ok: true });
    expect(await reserve(beto.id, 30, 2)).toEqual({ ok: false, limit: "global" });
  });

  it("counts only the last 24 hours, on the database's clock", async () => {
    for (let i = 0; i < 3; i++) await reserve(ana.id);
    await db.update(chatMessages).set({ createdAt: sql`now() - interval '25 hours'` });
    expect(await reserve(ana.id)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("lets only one of two messages sent at once through the last place under the cap", async () => {
    // PGlite runs one transaction at a time anyway, so this guards against a regression rather than proving the
    // lock: on Neon, the lock every reservation takes first is what keeps two from counting the same rows (next test).
    await reserve(ana.id, 2);
    const both = await Promise.all([reserve(ana.id, 2), reserve(ana.id, 2)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.filter((r) => !r.ok)).toEqual([{ ok: false, limit: "member" }]);
    expect(await db.select().from(chatMessages)).toHaveLength(2);
  });

  it("takes the one lock every reservation shares first in the batch Neon runs, whoever reserves", async () => {
    // Neon's HTTP driver is faked at the client: what's checked is the batch drizzle builds for it, which PGlite never runs.
    const batches: { sql: string; params: unknown[] }[][] = [];
    const client = Object.assign((sql: string, params: unknown[]) => ({ sql, params }), {
      transaction: async (queries: { sql: string; params: unknown[] }[]) => {
        batches.push(queries);
        return queries.map(() => ({ rows: [] }));
      },
    });
    const neon = drizzleNeon({ client: client as never, schema }) as unknown as Db;
    for (const userId of [ana.id, beto.id]) {
      // The fake has no rows to answer with, so nothing is reserved.
      expect(await reserveChatMessage(neon, { userId, fundId, memberLimit: 3, globalLimit: 100 })).toEqual({ ok: false, limit: "member" });
    }
    expect(batches).toHaveLength(2);
    const [[lock, insert, read], [otherLock]] = batches as [{ sql: string; params: unknown[] }[], { sql: string; params: unknown[] }[]];
    expect(lock).toEqual({ sql: "select pg_advisory_xact_lock($1)", params: [CHAT_RESERVE_LOCK] });
    expect(otherLock).toEqual(lock); // the same key for another person
    expect(batches[0]).toHaveLength(3);
    expect(insert!.sql).toMatch(/^insert into "chat_messages"/);
    expect(read!.sql).toMatch(/^select .* from "users"/);
  });
});

describe("recordChatUsage", () => {
  it("keeps the tokens and how the answer ended, and nothing of what was said", async () => {
    const reservation = await reserve(ana.id);
    if (!reservation.ok) throw new Error("expected a reservation");
    await recordChatUsage(db, reservation.id, { inputTokens: 2_100, outputTokens: 180, finish: "stop" });
    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, reservation.id));
    expect(row).toMatchObject({ userId: ana.id, fundId, inputTokens: 2_100, outputTokens: 180, finish: "stop" });
    expect(Object.keys(row!).sort()).toEqual(["createdAt", "finish", "fundId", "id", "inputTokens", "outputTokens", "userId"]);
  });
});
