import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { type Db, inTransaction } from "../src/lib/db/client";
import { acquireLock, releaseLock, withLock } from "../src/lib/db/lock";
import { expenses, funds, users } from "../src/lib/db/schema";
import { WARS, addLiveFund, addUser, randomAccount, testDb } from "./support/db";

describe("the database", () => {
  it("keeps amounts of any size as bigint", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    const fund = await addLiveFund(db, { creatorId: ema.id, address: randomAccount(), members: [ema.id] });
    const [row] = await db.select().from(funds).where(eq(funds.id, fund.id));
    expect(row?.balanceCap).toBe(450_000n * WARS);
    expect(row?.createdBlock).toBe(79_700_000n);
  });

  it("allows one account per person", async () => {
    const db = await testDb();
    const account = randomAccount();
    await addUser(db, "Ema", account);
    await expect(addUser(db, "Otra", account)).rejects.toThrow();
  });

  it("keeps one expense per person and client key", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    const fund = await addLiveFund(db, { creatorId: ema.id, address: randomAccount(), members: [ema.id] });
    const expense = (ref: string) => ({
      id: randomUUID(),
      fundId: fund.id,
      userId: ema.id,
      clientKey: "k1",
      kind: "agreed" as const,
      amount: 45_000n * WARS,
      note: "cancha",
      ref,
    });
    await db.insert(expenses).values(expense("0x01"));
    await expect(db.insert(expenses).values(expense("0x02"))).rejects.toThrow();
  });
});

describe("the lock", () => {
  it("lets one owner hold it until it releases it or its time runs out", async () => {
    const db = await testDb();
    expect(await acquireLock(db, "agent", "a", 60_000)).toBe(true);
    expect(await acquireLock(db, "agent", "b", 60_000)).toBe(false);
    await releaseLock(db, "agent", "b"); // not b's to release
    expect(await acquireLock(db, "agent", "b", 60_000)).toBe(false);
    await releaseLock(db, "agent", "a");
    expect(await acquireLock(db, "agent", "b", 1)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await acquireLock(db, "agent", "c", 60_000)).toBe(true); // b's ran out
  });

  it("runs one function at a time, and frees the lock even when it throws", async () => {
    const db = await testDb();
    let release!: () => void;
    const first = withLock(db, "agent", 60_000, () => new Promise<string>((resolve) => (release = () => resolve("first"))));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await withLock(db, "agent", 60_000, async () => "second")).toEqual({ ran: false });
    release();
    expect(await first).toEqual({ ran: true, value: "first" });
    await expect(withLock(db, "agent", 60_000, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withLock(db, "agent", 60_000, async () => "after")).toEqual({ ran: true, value: "after" });
  });
});

describe("inTransaction", () => {
  it("runs its statements in order, in one transaction: when one fails, none of them is kept", async () => {
    const db = await testDb();
    const account = randomAccount();
    const [inserted, read] = await inTransaction(db, (tx) => [
      tx.insert(users).values({ name: "Ema", account }).returning({ name: users.name }),
      tx.select({ name: users.name }).from(users).where(eq(users.account, account)),
    ]);
    expect(inserted).toEqual([{ name: "Ema" }]);
    expect(read).toEqual([{ name: "Ema" }]); // the second sees the first

    const twice = randomAccount();
    const failing = inTransaction(db, (tx) => [tx.insert(users).values({ name: "Uno", account: twice }), tx.insert(users).values({ name: "Dos", account: twice })]);
    await expect(failing).rejects.toThrow();
    expect(await db.select().from(users).where(eq(users.account, twice))).toEqual([]);
  });

  it("sends them as one batch where the driver has batches and no transactions, as Neon's HTTP one", async () => {
    const batch = vi.fn(async (statements: readonly unknown[]) => statements.map((statement) => `ran ${String(statement)}`));
    const transaction = vi.fn(() => {
      throw new Error("No transactions support in neon-http driver");
    });
    const neon = { batch, transaction } as unknown as Db;
    let builtOn: Db | undefined;
    const results = await inTransaction(neon, (tx) => {
      builtOn = tx;
      return ["lock", "insert"] as unknown as [PromiseLike<string>, PromiseLike<string>];
    });
    expect(builtOn).toBe(neon);
    expect(batch).toHaveBeenCalledWith(["lock", "insert"]);
    expect(transaction).not.toHaveBeenCalled();
    expect(results).toEqual(["ran lock", "ran insert"]);
  });
});
