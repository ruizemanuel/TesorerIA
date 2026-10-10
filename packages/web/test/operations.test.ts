import { type Hash, getAddress, pad } from "viem";
import { describe, expect, it } from "vitest";
import { funds, operations } from "../src/lib/db/schema";
import { PENDING_FOR_MS, dropOperation, finishOperation, ownsDraft, pendingOperations, recordOperation } from "../src/lib/operations";
import { addUser, testDb } from "./support/db";

const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const OP: Hash = pad("0x01", { size: 32 });
const OP_LATER: Hash = pad("0x03", { size: 32 });
const TX: Hash = pad("0x02", { size: 32 });

describe("operations on their way", () => {
  it("shows a member's operation until its receipt arrives, and only to them", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    const juan = await addUser(db, "Juan");
    await recordOperation(db, ema.id, { userOpHash: OP, kind: "contribute", fund: FUND, amount: 10_000_000n, token: "usdt" });
    await recordOperation(db, ema.id, { userOpHash: OP, kind: "contribute", fund: FUND, amount: 10_000_000n, token: "usdt" }); // a retry
    expect(await pendingOperations(db, ema.id, FUND)).toMatchObject([{ userOpHash: OP, amount: 10_000_000n, token: "usdt" }]);
    expect(await pendingOperations(db, juan.id, FUND)).toEqual([]);
    await finishOperation(db, juan.id, { userOpHash: OP, transactionHash: TX, success: true }); // not Juan's
    expect(await pendingOperations(db, ema.id, FUND)).toHaveLength(1);
    await finishOperation(db, ema.id, { userOpHash: OP, transactionHash: TX, success: true });
    expect(await pendingOperations(db, ema.id, FUND)).toEqual([]);
  });

  it("stops showing an operation that never came back after 15 minutes", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    await recordOperation(db, ema.id, { userOpHash: OP, kind: "vote", fund: FUND });
    expect(await pendingOperations(db, ema.id, FUND, new Date(Date.now() + 16 * 60_000))).toEqual([]);
  });

  it("lists the newest first", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    await recordOperation(db, ema.id, { userOpHash: OP, kind: "vote", fund: FUND });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordOperation(db, ema.id, { userOpHash: OP_LATER, kind: "vote", fund: FUND });
    expect((await pendingOperations(db, ema.id, FUND)).map((row) => row.userOpHash)).toEqual([OP_LATER, OP]);
  });

  it("keeps the draft a create-fund operation deploys, and lets only the draft's creator claim it", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    const juan = await addUser(db, "Juan");
    const [draft] = await db
      .insert(funds)
      .values({ name: "Draft", agreedExpense: "x", weeklyFee: 1n, weeklyCap: 1n, balanceCap: 1n, creatorId: ana.id, inviteCode: "draft-code" })
      .returning();
    expect(await ownsDraft(db, ana.id, draft!.id)).toBe(true);
    expect(await ownsDraft(db, juan.id, draft!.id)).toBe(false);
    expect(await ownsDraft(db, ana.id, crypto.randomUUID())).toBe(false);
    await recordOperation(db, ana.id, { userOpHash: OP, kind: "create-fund", draftId: draft!.id });
    const [row] = await db.select().from(operations);
    expect(row).toMatchObject({ userOpHash: OP, kind: "create-fund", draftId: draft!.id, fund: null });
  });
});

describe("dropOperation", () => {
  it("takes an operation as dropped only once it's older than PENDING_FOR_MS without a receipt, and only from its sender", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    const juan = await addUser(db, "Juan");
    await recordOperation(db, ema.id, { userOpHash: OP, kind: "vote", fund: FUND });
    const later = new Date(Date.now() + PENDING_FOR_MS + 60_000);
    expect(await dropOperation(db, ema.id, OP)).toBe(false); // too recent: it may still land
    expect(await dropOperation(db, juan.id, OP, later)).toBe(false); // not Juan's
    expect(await dropOperation(db, ema.id, OP, later)).toBe(true);
    expect(await dropOperation(db, ema.id, OP, later)).toBe(true); // asking twice gives the same answer
    expect(await db.select().from(operations)).toMatchObject([{ userOpHash: OP, success: false, transactionHash: null }]);

    await recordOperation(db, ema.id, { userOpHash: OP_LATER, kind: "vote", fund: FUND });
    await finishOperation(db, ema.id, { userOpHash: OP_LATER, transactionHash: TX, success: true });
    expect(await dropOperation(db, ema.id, OP_LATER, later)).toBe(false); // it has its receipt
  });
});
