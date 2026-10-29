import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { type Db, inTransaction } from "../src/lib/db/client";
import { acquireLock, lockTimeLeft, releaseLock, withLock } from "../src/lib/db/lock";
import { credentials, expenses, funds, users } from "../src/lib/db/schema";
import { WARS, addLiveFund, addUser, randomAccount, testDb } from "./support/db";

describe("the test databases", () => {
  let openedByTheTestBefore: Db | undefined;

  it("gives each test a database of its own: what one writes, the next never sees", async () => {
    const first = await testDb();
    await addUser(first, "Ema");
    const second = await testDb();
    expect(await second.select().from(users)).toEqual([]);
    await addUser(second, "Otra");
    expect((await first.select().from(users)).map((user) => user.name)).toEqual(["Ema"]);
    openedByTheTestBefore = first;
  });

  // The two run in order: this one checks the database the one above opened.
  it("closes a test's database when the test ends, since each one holds about 250 MB", () => {
    expect((openedByTheTestBefore as unknown as { $client: PGlite }).$client.closed).toBe(true);
  });
});

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

describe("a person's passkeys", () => {
  const passkey = (userId: string, state: "active" | "pending" | "retired") => ({
    id: randomUUID(),
    userId,
    publicKey: "0x04",
    userHandle: "0x01",
    rpId: "tesoreria.finance",
    state,
  });
  const uniqueViolation = (index: string) => expect.objectContaining({ cause: expect.objectContaining({ code: "23505", constraint: index }) });

  it("keeps one active passkey per person", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    await db.insert(credentials).values(passkey(ema.id, "active"));
    await expect(db.insert(credentials).values(passkey(ema.id, "active"))).rejects.toEqual(uniqueViolation("credentials_one_active"));
  });

  it("keeps one pending passkey per person", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    await db.insert(credentials).values(passkey(ema.id, "pending"));
    await expect(db.insert(credentials).values(passkey(ema.id, "pending"))).rejects.toEqual(uniqueViolation("credentials_one_pending"));
  });

  it("lets an active passkey and a pending one live together, with any number retired", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    await db.insert(credentials).values([passkey(ema.id, "active"), passkey(ema.id, "pending"), passkey(ema.id, "retired"), passkey(ema.id, "retired")]);
    expect(await db.select().from(credentials).where(eq(credentials.userId, ema.id))).toHaveLength(4);
  });

  it("counts per person: someone else has an active passkey and a pending one of their own", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    const other = await addUser(db, "Otra");
    await db.insert(credentials).values([passkey(ema.id, "active"), passkey(ema.id, "pending"), passkey(other.id, "active"), passkey(other.id, "pending")]);
    expect(await db.select().from(credentials)).toHaveLength(4);
  });

  it("starts as active, and has to be told its site", async () => {
    const db = await testDb();
    const ema = await addUser(db, "Ema");
    const noSite = { id: randomUUID(), userId: ema.id, publicKey: "0x04", userHandle: "0x01" };
    // @ts-expect-error rpId has no default: a passkey is always made for a site.
    await expect(db.insert(credentials).values(noSite)).rejects.toThrow();
    const [row] = await db.insert(credentials).values({ ...noSite, rpId: "tesoreria.finance" }).returning();
    expect(row?.state).toBe("active");
  });
});

describe("the migration that gives each passkey its site and state", () => {
  it("puts every passkey that existed on the old site, and keeps only each person's newest active", async () => {
    // A database as it was before this migration, with passkeys in it; then the real folder on top, as a deploy does.
    const migrations = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(migrations, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const earlier = journal.entries.filter((entry) => entry.tag !== "0008_passkey_sites");
    const before = mkdtempSync(path.join(tmpdir(), "migrations-before-"));
    mkdirSync(path.join(before, "meta"));
    writeFileSync(path.join(before, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: earlier }));
    for (const { tag } of earlier) cpSync(path.join(migrations, `${tag}.sql`), path.join(before, `${tag}.sql`));
    const client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: before });
    rmSync(before, { recursive: true });

    const person = async (name: string, account: string) =>
      (await client.query<{ id: string }>("INSERT INTO users (name, account) VALUES ($1, $2) RETURNING id", [name, account])).rows[0]!.id;
    const passkeyOf = (id: string, userId: string, day: number) =>
      client.query("INSERT INTO credentials (id, user_id, public_key, user_handle, created_at) VALUES ($1, $2, '0x04', '0x01', $3)", [
        id,
        userId,
        new Date(Date.UTC(2026, 9, day)),
      ]);
    const ema = await person("Ema", "0x01");
    const otra = await person("Otra", "0x02");
    await passkeyOf("ema-first", ema, 10);
    await passkeyOf("ema-latest", ema, 20);
    await passkeyOf("ema-middle", ema, 15);
    await passkeyOf("otra-only", otra, 12);

    await migrate(db, { migrationsFolder: migrations });

    const { rows } = await client.query<{ id: string; rp_id: string; state: string }>("SELECT id, rp_id, state FROM credentials ORDER BY id");
    expect(rows).toEqual([
      { id: "ema-first", rp_id: "tesoreriaia.vercel.app", state: "retired" },
      { id: "ema-latest", rp_id: "tesoreriaia.vercel.app", state: "active" },
      { id: "ema-middle", rp_id: "tesoreriaia.vercel.app", state: "retired" },
      { id: "otra-only", rp_id: "tesoreriaia.vercel.app", state: "active" },
    ]);
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
    // b's runs out a millisecond later on the database's clock, the one acquireLock compares with. A fixed 20 ms sleep
    // failed once in a VM under load (whose time sync can set the clock back), so this waits until it has run out.
    await vi.waitFor(async () => expect(await acquireLock(db, "agent", "c", 60_000)).toBe(true));
  });

  it("says how long until it runs out, on the database's clock, and 0 when nobody holds it", async () => {
    const db = await testDb();
    expect(await lockTimeLeft(db, "cooldown")).toBe(0);
    await acquireLock(db, "cooldown", "a", 38_000);
    const left = await lockTimeLeft(db, "cooldown");
    expect(left).toBeGreaterThan(37_000);
    expect(left).toBeLessThanOrEqual(38_000);
    // Run out: a lock left in the table no longer counts.
    await acquireLock(db, "gone", "a", 1);
    await vi.waitFor(async () => expect(await lockTimeLeft(db, "gone")).toBe(0));
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
