import { type Address, type Hash, getAddress, pad, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { funds, operations } from "../src/lib/db/schema";
import { cashOutPending, finishOperation, lastOperationBlock, ownsDraft, pendingOperations, recordOperation } from "../src/lib/operations";
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

describe("recordOperation", () => {
  it("keeps the nonce an operation went out with", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    await recordOperation(db, ema.id, { userOpHash: OP, kind: "vote", fund: FUND, nonce: 7n });
    await recordOperation(db, ema.id, { userOpHash: OP_LATER, kind: "vote", fund: FUND });
    expect((await db.select().from(operations).orderBy(operations.userOpHash)).map((o) => [o.userOpHash, o.nonce])).toEqual([
      [OP, 7n],
      [OP_LATER, null],
    ]);
  });
});

describe("lastOperationBlock: what a member's next read must reach (read-your-writes)", () => {
  it("is the latest block among the member's landed operations, in one fund or in any, and null without one", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    const juan = await addUser(db, "Juan");
    const OTHER: Address = getAddress("0x00000000000000000000000000000000000f00d2");
    const land = async (userId: string, n: number, fund: Address, block?: bigint) => {
      const userOpHash: Hash = pad(toHex(n), { size: 32 });
      await recordOperation(db, userId, { userOpHash, kind: "vote", fund });
      if (block !== undefined) await finishOperation(db, userId, { userOpHash, transactionHash: TX, success: true, block });
    };
    expect(await lastOperationBlock(db, ema.id, FUND)).toBeNull();
    await land(ema.id, 10, FUND, 100n);
    await land(ema.id, 11, FUND, 90n);
    await land(ema.id, 12, OTHER, 300n);
    await land(ema.id, 13, FUND); // no receipt yet
    await land(juan.id, 14, FUND, 500n);
    expect(await lastOperationBlock(db, ema.id, FUND)).toBe(100n);
    expect(await lastOperationBlock(db, ema.id)).toBe(300n);
    expect(await lastOperationBlock(db, juan.id, OTHER)).toBeNull();
  });
});

describe("cashOutPending: a pass to pesos on its way (spec, 9.2)", () => {
  const PASS: Hash = pad("0x0c", { size: 32 });

  it("is true for the member who sent it until its receipt arrives, and for no one else", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    const juan = await addUser(db, "Juan");
    expect(await cashOutPending(db, ema.id)).toBe(false);
    await recordOperation(db, ema.id, { userOpHash: PASS, kind: "cash-out", amount: 45_000n * 10n ** 18n, token: "wars" });
    expect(await cashOutPending(db, ema.id)).toBe(true);
    expect(await cashOutPending(db, juan.id)).toBe(false);
    await finishOperation(db, ema.id, { userOpHash: PASS, transactionHash: TX, success: true });
    expect(await cashOutPending(db, ema.id)).toBe(false);
  });

  it("is true only within 15 minutes, so a pass that never came back doesn't block the next one for good", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    await recordOperation(db, ema.id, { userOpHash: PASS, kind: "cash-out", amount: 1n, token: "wars" });
    expect(await cashOutPending(db, ema.id, new Date(Date.now() + 14 * 60_000))).toBe(true);
    expect(await cashOutPending(db, ema.id, new Date(Date.now() + 16 * 60_000))).toBe(false);
  });

  it("is false for the member's other operations on their way", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    await recordOperation(db, ema.id, { userOpHash: OP, kind: "contribute", fund: FUND, amount: 1n, token: "wars" });
    await recordOperation(db, ema.id, { userOpHash: OP_LATER, kind: "vote", fund: FUND });
    expect(await cashOutPending(db, ema.id)).toBe(false);
    expect(await pendingOperations(db, ema.id, FUND)).toHaveLength(2);
  });
});
