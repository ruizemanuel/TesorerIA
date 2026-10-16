import { and, eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db/client";
import { funds, joinRequests, memberships } from "../src/lib/db/schema";
import { MAX_MEMBERS } from "../src/lib/fund-abi";
import { joinFund } from "../src/lib/funds";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { JOIN_REQUEST_DAYS, MAX_OPEN_JOIN_REQUESTS, joinRequestOf, requestToJoin, requestsOf, sponsoredJoinRequests } from "../src/lib/join-requests";
import { addLiveFund, addUser, randomAccount, recordTransactions, testDb } from "./support/db";

/** A live fund of Ana, Beto and Caro, and Lucas, who isn't in it. */
async function liveFund(db: Db) {
  const [ana, beto, caro, lucas] = [await addUser(db, "Ana"), await addUser(db, "Beto"), await addUser(db, "Caro"), await addUser(db, "Lucas")];
  const fund = await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id, beto.id, caro.id] });
  return { fund, ana, lucas };
}

/** Moves `userId`'s requests `days` days into the past, as if they had been made then. */
async function age(db: Db, userId: string, days: number) {
  await db
    .update(joinRequests)
    .set({ createdAt: sql`now() - ${days} * interval '1 day'` })
    .where(eq(joinRequests.userId, userId));
}

/** Fills the fund's open requests with `count` new people. */
async function othersAsk(db: Db, fundId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const person = await addUser(db, `P${i}`);
    expect(await requestToJoin(db, fundId, person.id, es), person.name).toMatchObject({ ok: true });
  }
}

describe("requestToJoin (spec, 9.4)", () => {
  it("takes a request to join a live fund, open for 7 days, and lists it for the person while it's open", async () => {
    const db = await testDb();
    const { fund, lucas } = await liveFund(db);
    const asked = await requestToJoin(db, fund.id, lucas.id, es);
    expect(asked).toEqual({ ok: true, requestedAt: expect.any(Date) });
    expect(await joinRequestOf(db, fund.id, lucas.id)).toEqual({ requestedAt: asked.ok && asked.requestedAt, open: true });
    expect(await requestsOf(db, lucas.id)).toEqual([{ fundId: fund.id, name: fund.name, inviteCode: fund.inviteCode, requestedAt: expect.any(Date) }]);

    await age(db, lucas.id, JOIN_REQUEST_DAYS + 1);
    expect(await joinRequestOf(db, fund.id, lucas.id)).toMatchObject({ open: false });
    expect(await requestsOf(db, lucas.id)).toEqual([]);
    expect(await joinRequestOf(db, fund.id, (await addUser(db, "Nadie")).id)).toBeNull();
  });

  it("keeps one request for a double tap or two tabs at once, with its first date (Review Focus 5)", async () => {
    const db = await testDb();
    const { fund, lucas } = await liveFund(db);
    const [first, second] = await Promise.all([requestToJoin(db, fund.id, lucas.id, es), requestToJoin(db, fund.id, lucas.id, es)]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    const again = await requestToJoin(db, fund.id, lucas.id, es);
    expect(again.ok && again.requestedAt).toEqual(first.ok && first.requestedAt);
    expect(await db.$count(joinRequests, eq(joinRequests.fundId, fund.id))).toBe(1);
  });

  it("renews a request that expired, from now, and only one that expired", async () => {
    const db = await testDb();
    const { fund, lucas } = await liveFund(db);
    await requestToJoin(db, fund.id, lucas.id, es);
    await age(db, lucas.id, JOIN_REQUEST_DAYS + 1);
    const old = (await joinRequestOf(db, fund.id, lucas.id))!.requestedAt;
    const renewed = await requestToJoin(db, fund.id, lucas.id, es);
    expect(renewed).toMatchObject({ ok: true });
    expect(renewed.ok && renewed.requestedAt.getTime()).toBeGreaterThan(old.getTime());
    expect(await joinRequestOf(db, fund.id, lucas.id)).toMatchObject({ open: true });
  });

  it("refuses a member, a fund with 10 members, and a sixth open request, and takes it once one of those expires", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    expect(await requestToJoin(db, fund.id, ana.id, es)).toEqual({ ok: false, status: 409, error: "Ya sos parte de este fondo." });

    await othersAsk(db, fund.id, MAX_OPEN_JOIN_REQUESTS);
    expect(await requestToJoin(db, fund.id, lucas.id, es)).toEqual({
      ok: false,
      status: 409,
      error: "Ya hay muchos pedidos para sumarse a este fondo. Probá en unos días.",
    });
    const [oldest] = await db.select({ userId: joinRequests.userId }).from(joinRequests).where(eq(joinRequests.fundId, fund.id)).limit(1);
    await age(db, oldest!.userId, JOIN_REQUEST_DAYS + 1);
    expect(await requestToJoin(db, fund.id, lucas.id, es)).toMatchObject({ ok: true });

    const full = await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
    for (let i = 1; i < MAX_MEMBERS; i++) await db.insert(memberships).values({ fundId: full.id, userId: (await addUser(db, `M${i}`)).id });
    expect(await requestToJoin(db, full.id, lucas.id, es)).toEqual({ ok: false, status: 409, error: "El fondo ya tiene 10 miembros, que es el máximo." });
  });

  it("gives the fifth place to only one of two people who ask at once (Review Focus 5)", async () => {
    const db = await testDb();
    const { fund } = await liveFund(db);
    await othersAsk(db, fund.id, MAX_OPEN_JOIN_REQUESTS - 1);
    const [juan, kari] = [await addUser(db, "Juan"), await addUser(db, "Kari")];
    // Both read four before either writes: only the insert itself can tell them apart.
    const results = await Promise.all([requestToJoin(db, fund.id, juan.id, es), requestToJoin(db, fund.id, kari.id, es)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.$count(joinRequests, eq(joinRequests.fundId, fund.id))).toBe(MAX_OPEN_JOIN_REQUESTS);
  });

  it("locks the fund's row to write a request, in the same transaction, as a join does", async () => {
    // PGlite runs one statement at a time, so the race can't happen here: what keeps it from happening on Neon is
    // the row's lock, taken first, in the same transaction as the insert that counts.
    const db = await testDb();
    const { fund, lucas } = await liveFund(db);
    const transactions = recordTransactions(db);
    await requestToJoin(db, fund.id, lucas.id, es);
    expect(transactions).toEqual([
      [expect.stringMatching(/^select .* from "funds" where "funds"."id" = \$1 for update$/), expect.stringMatching(/^insert into "join_requests"/)],
    ]);
  });

  it("is what a live fund's link does for someone new, and a member still goes to their fund", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    expect(await joinFund(db, lucas.id, fund.inviteCode, es)).toEqual({ ok: true, fundId: fund.id, status: "requested", address: fund.address });
    expect(await joinRequestOf(db, fund.id, lucas.id)).toMatchObject({ open: true });
    expect(await joinFund(db, ana.id, fund.inviteCode, es)).toEqual({ ok: true, fundId: fund.id, status: "live", address: fund.address });
    expect(await db.select().from(joinRequests).where(and(eq(joinRequests.fundId, fund.id), eq(joinRequests.userId, ana.id)))).toEqual([]);
  });

  it("says why not in English", async () => {
    const db = await testDb();
    const { fund, ana } = await liveFund(db);
    expect(await requestToJoin(db, fund.id, ana.id, en)).toEqual({ ok: false, status: 409, error: "You're already in this fund." });
    expect(en.funds.liveFull).toBe("The fund already has 10 members, which is the most it can have.");
    expect(en.funds.manyRequests).toBe("Many people are already asking to join this fund. Try again in a few days.");
  });
});

describe("sponsoredJoinRequests (spec, 9.4)", () => {
  it("lists the open requests of a member's live funds, with the account each asked from, and nobody else's", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    await requestToJoin(db, fund.id, lucas.id, es);
    expect(await sponsoredJoinRequests(db, ana.id)).toEqual([{ fund: fund.address, account: getAddress(lucas.account) }]);
    expect(await sponsoredJoinRequests(db, lucas.id)).toEqual([]); // he isn't in it
    await age(db, lucas.id, JOIN_REQUEST_DAYS + 1);
    expect(await sponsoredJoinRequests(db, ana.id)).toEqual([]);
  });

  it("leaves out a fund that already has 10 members, whose AddMember the contract would refuse (Review Focus 4)", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    await requestToJoin(db, fund.id, lucas.id, es);
    for (let i = 3; i < MAX_MEMBERS; i++) await db.insert(memberships).values({ fundId: fund.id, userId: (await addUser(db, `M${i}`)).id });
    expect(await sponsoredJoinRequests(db, ana.id)).toEqual([]);
  });

  it("leaves out a request in a fund that isn't live, or has no address yet, each condition on its own", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    await requestToJoin(db, fund.id, lucas.id, es);
    // Requests are only made in live funds, so neither state happens: they pin that the list is the live funds' alone.
    await db.update(funds).set({ status: "deploying" }).where(eq(funds.id, fund.id));
    expect(await sponsoredJoinRequests(db, ana.id)).toEqual([]);
    await db.update(funds).set({ status: "live", address: null }).where(eq(funds.id, fund.id));
    expect(await sponsoredJoinRequests(db, ana.id)).toEqual([]);
  });

  it("still lists a fund with 9 members, which has room for a tenth, and each request only to the members of its own fund", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    await requestToJoin(db, fund.id, lucas.id, es);
    for (let i = 3; i < MAX_MEMBERS - 1; i++) await db.insert(memberships).values({ fundId: fund.id, userId: (await addUser(db, `M${i}`)).id });
    expect(await db.$count(memberships, eq(memberships.fundId, fund.id))).toBe(MAX_MEMBERS - 1);
    expect(await sponsoredJoinRequests(db, ana.id)).toEqual([{ fund: fund.address, account: getAddress(lucas.account) }]);

    // Dani is in another live fund and Lucas asks there too: each of them sees only the request of their own fund.
    const dani = await addUser(db, "Dani");
    const other = await addLiveFund(db, { creatorId: dani.id, address: randomAccount(), members: [dani.id] });
    expect(await sponsoredJoinRequests(db, dani.id)).toEqual([]);
    await requestToJoin(db, other.id, lucas.id, es);
    expect(await sponsoredJoinRequests(db, dani.id)).toEqual([{ fund: other.address, account: getAddress(lucas.account) }]);
    expect(await sponsoredJoinRequests(db, ana.id)).toEqual([{ fund: fund.address, account: getAddress(lucas.account) }]);
  });
});
