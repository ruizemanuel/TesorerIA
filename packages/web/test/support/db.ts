import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { type Address, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { TestRunner, onTestFinished } from "vitest";
import { type Db, openDb } from "../../src/lib/db/client";
import * as schema from "../../src/lib/db/schema";
import { funds, memberships, users } from "../../src/lib/db/schema";

export const WARS = 10n ** 18n;

/**
 * One migrated database per test file, which no test writes to. A new PGlite runs initdb, which takes seconds (most of
 * a test's time, and over the hook's timeout on a busy machine); a clone of this one takes a fraction of that.
 */
let template: Promise<PGlite> | undefined;

/**
 * A database of its own, with every migration applied: a copy of the template. Each one holds about 250 MB until it is
 * closed, so it closes when the test that opened it ends, whether it opened in the test or in a beforeEach; one opened
 * in a beforeAll is the whole file's.
 */
export async function testDb(): Promise<Db> {
  template ??= openDb("memory").then((db) => (db as unknown as { $client: PGlite }).$client);
  const client = (await (await template).clone()) as PGlite;
  if (TestRunner.getCurrentTest()) onTestFinished(() => client.close());
  return drizzle({ client, schema }) as unknown as Db;
}

/** A throwaway address, as a member's Safe would be. */
export function randomAccount(): Address {
  return getAddress(privateKeyToAddress(generatePrivateKey()));
}

export async function addUser(db: Db, name: string, account: Address = randomAccount()) {
  const [user] = await db.insert(users).values({ name, account }).returning();
  return user!;
}

/** A live fund with these members, in this order: the spec's defaults (4). */
export async function addLiveFund(
  db: Db,
  { creatorId, address, members }: { creatorId: string; address: Address; members: string[] },
) {
  const [fund] = await db
    .insert(funds)
    .values({
      name: "Fútbol de los jueves",
      agreedExpense: "la cancha",
      weeklyFee: 10_000n * WARS,
      weeklyCap: 60_000n * WARS,
      balanceCap: 450_000n * WARS,
      votesRequired: 2,
      creatorId,
      inviteCode: `code-${address}`,
      status: "live",
      address,
      createdBlock: 79_700_000n,
    })
    .returning();
  for (const [i, userId] of members.entries()) {
    await db.insert(memberships).values({ fundId: fund!.id, userId, joinedAt: new Date(Date.UTC(2026, 9, 10, 12, i)) });
  }
  return fund!;
}

/** The statements of each transaction `db` runs from now on, in order (PGlite's own transactions, under drizzle's). */
export function recordTransactions(db: Db): string[][] {
  type Query = (sql: string, ...rest: unknown[]) => Promise<unknown>;
  type Client = { transaction: (fn: (tx: { query: Query }) => Promise<unknown>) => Promise<unknown> };
  const client = (db as unknown as { $client: Client }).$client;
  const transactions: string[][] = [];
  const transaction = client.transaction.bind(client);
  client.transaction = (fn) =>
    transaction((tx) => {
      const statements: string[] = [];
      transactions.push(statements);
      const query = tx.query.bind(tx);
      tx.query = (sql, ...rest) => {
        statements.push(sql);
        return query(sql, ...rest);
      };
      return fn(tx);
    });
  return transactions;
}
