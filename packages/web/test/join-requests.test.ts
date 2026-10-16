import { and, eq, sql } from "drizzle-orm";
import { type Address, getAddress, zeroAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "../src/lib/db/client";
import { funds, joinRequests, memberships } from "../src/lib/db/schema";
import { MAX_MEMBERS } from "../src/lib/fund-abi";
import { draftById, joinFund } from "../src/lib/funds";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import {
  JOIN_REQUEST_DAYS,
  MAX_OPEN_JOIN_REQUESTS,
  admitMembers,
  joinProgress,
  joinRequestOf,
  joinStateOf,
  openRequestsFromOthers,
  requestToJoin,
  requestsIn,
  requestsOf,
  sponsoredJoinRequests,
} from "../src/lib/join-requests";
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

describe("openRequestsFromOthers (spec, 9.4)", () => {
  it("counts the fund's open requests, leaving out the viewer's own and the expired ones, and sees no one in another fund", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    const other = await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
    expect(await openRequestsFromOthers(db, fund.id, null)).toBe(0);
    await othersAsk(db, fund.id, 3);
    await othersAsk(db, other.id, 2);
    await requestToJoin(db, fund.id, lucas.id, es);
    expect(await openRequestsFromOthers(db, fund.id, null)).toBe(4);
    expect(await openRequestsFromOthers(db, fund.id, lucas.id)).toBe(3);
    await age(db, lucas.id, JOIN_REQUEST_DAYS + 1);
    expect(await openRequestsFromOthers(db, fund.id, null)).toBe(3);
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

describe("admitMembers (spec, 9.4)", () => {
  it("gives a row to whoever the chain lists with a request here, drops the request, and does nothing twice", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    const stranger = await addUser(db, "Nadie");
    await requestToJoin(db, fund.id, lucas.id, es);
    const onChain = [getAddress(ana.account), getAddress(lucas.account), getAddress(stranger.account)];

    expect(await admitMembers(db, fund.id, onChain)).toEqual([lucas.id]);
    expect(await db.$count(memberships, and(eq(memberships.fundId, fund.id), eq(memberships.userId, lucas.id)))).toBe(1);
    expect(await joinRequestOf(db, fund.id, lucas.id)).toBeNull();
    // Without a request there's nothing to catch up: the chain listing someone isn't enough to get a row.
    expect(await db.$count(memberships, and(eq(memberships.fundId, fund.id), eq(memberships.userId, stranger.id)))).toBe(0);
    expect(await admitMembers(db, fund.id, onChain)).toEqual([]);
    expect(await admitMembers(db, fund.id, [])).toEqual([]);
  });

  it("admits from an expired request too: the chain took them, whenever it was proposed", async () => {
    const db = await testDb();
    const { fund, lucas } = await liveFund(db);
    await requestToJoin(db, fund.id, lucas.id, es);
    await age(db, lucas.id, JOIN_REQUEST_DAYS + 3);
    expect(await admitMembers(db, fund.id, [getAddress(lucas.account).toLowerCase() as `0x${string}`])).toEqual([lucas.id]);
  });

  it("lists everyone who asked, open or not, with their name and account, oldest first", async () => {
    const db = await testDb();
    const { fund, lucas } = await liveFund(db);
    const mora = await addUser(db, "Mora");
    await requestToJoin(db, fund.id, lucas.id, es);
    await age(db, lucas.id, JOIN_REQUEST_DAYS + 1);
    await requestToJoin(db, fund.id, mora.id, es);
    expect(await requestsIn(db, fund.id)).toEqual([
      { userId: lucas.id, name: "Lucas", account: getAddress(lucas.account), requestedAt: expect.any(Date), open: false },
      { userId: mora.id, name: "Mora", account: getAddress(mora.account), requestedAt: expect.any(Date), open: true },
    ]);
  });
});

type Proposal = { action: number; a: Address; b: Address; amount: bigint; deadline: bigint; executed: boolean; proposer: Address; note: string };

/** A fund on the chain with these proposals, where `account` is or isn't a member, at time `now`. */
function chain({ member = false, proposals = [] as Proposal[], now = 1_000_000n, fails = false } = {}) {
  return {
    getBlock: async () => ({ timestamp: now }),
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (fails) throw new Error("The node is down");
      switch (functionName) {
        case "isMember":
          return member;
        case "proposalCount":
          return BigInt(proposals.length);
        case "getProposal":
          return proposals[Number(args![0])];
        case "voteCount":
          return 1n;
        case "votesRequired":
          return 2;
      }
      throw new Error(`Unexpected read: ${functionName}`);
    },
  } as unknown as Parameters<typeof joinProgress>[0];
}

describe("joinProgress and joinStateOf: where a request stands on the chain (spec, 9.4)", () => {
  const FUND_ADDRESS = getAddress("0x00000000000000000000000000000000000f00d1");
  const LUCAS = getAddress("0x000000000000000000000000000000000000aaa4");
  const ANA_ACCOUNT = getAddress("0x000000000000000000000000000000000000aaa1");
  const adding = (a: Address, change: Partial<Proposal> = {}): Proposal => ({
    action: 1,
    a,
    b: zeroAddress,
    amount: 0n,
    deadline: 1_000_000n + 86_400n,
    executed: false,
    proposer: ANA_ACCOUNT,
    note: "",
    ...change,
  });

  it("says a member is one, and finds the open proposal that adds the account, with its votes", async () => {
    expect(await joinProgress(chain({ member: true }), FUND_ADDRESS, LUCAS)).toEqual({ member: true, proposal: null });
    const proposals = [adding(LUCAS), adding(LUCAS, { executed: true }), adding(LUCAS, { deadline: 999_999n }), { ...adding(LUCAS), action: 0 }, adding(ANA_ACCOUNT)];
    expect(await joinProgress(chain({ proposals }), FUND_ADDRESS, LUCAS)).toEqual({ member: false, proposal: { proposer: ANA_ACCOUNT, votes: 1, required: 2 } });
    expect(await joinProgress(chain({ proposals: proposals.slice(1) }), FUND_ADDRESS, LUCAS)).toEqual({ member: false, proposal: null });
    expect(await joinProgress(chain(), FUND_ADDRESS, LUCAS)).toEqual({ member: false, proposal: null });
  });

  it("looks only through the latest 20 proposals: one older than that has expired anyway", async () => {
    const proposals = [adding(LUCAS), ...Array.from({ length: 20 }, () => adding(ANA_ACCOUNT))];
    expect(await joinProgress(chain({ proposals }), FUND_ADDRESS, LUCAS)).toEqual({ member: false, proposal: null });
  });

  it("admits someone the chain already added, and names who proposed them", async () => {
    const db = await testDb();
    const { fund, ana, lucas } = await liveFund(db);
    const viewer = { id: lucas.id, account: getAddress(lucas.account) };
    const summary = (await draftById(db, fund.id))!;
    expect(await joinStateOf(db, chain({ member: true }), summary, viewer, es)).toEqual({ request: null, proposal: null, admitted: false }); // no request

    await requestToJoin(db, fund.id, lucas.id, es);
    const proposed = await joinStateOf(db, chain({ proposals: [adding(viewer.account, { proposer: getAddress(ana.account) })] }), summary, viewer, es);
    expect(proposed).toMatchObject({ request: { open: true }, proposal: { proposer: "Ana", votes: 1, required: 2 }, admitted: false });

    expect(await joinStateOf(db, chain({ member: true }), summary, viewer, es)).toMatchObject({ admitted: true });
    expect((await draftById(db, fund.id))!.members.map((member) => member.name)).toContain("Lucas");
  });

  it("shows the request as the database has it when the chain can't be read, and says why in the log", async () => {
    const db = await testDb();
    const { fund, lucas } = await liveFund(db);
    await requestToJoin(db, fund.id, lucas.id, es);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = await joinStateOf(db, chain({ fails: true }), (await draftById(db, fund.id))!, { id: lucas.id, account: getAddress(lucas.account) }, es);
    expect(state).toMatchObject({ request: { open: true }, proposal: null, admitted: false });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("The node is down"));
    logged.mockRestore();
  });
});
