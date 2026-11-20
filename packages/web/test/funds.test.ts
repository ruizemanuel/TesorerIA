import {
  AGENT_ADDRESS,
  FEE_BPS,
  FUND_FACTORY,
  FUND_FACTORY_V2,
  type FundVersion,
  POOL,
  USDT,
  WARS as WARS_TOKEN,
  fundFactoryAbi,
  fundFactoryV2Abi,
} from "@tesoreria/agent";
import { and, eq } from "drizzle-orm";
import { type Address, type Hash, type Hex, decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, pad } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { agentAddress } from "../src/lib/agent-address";
import type { UserOperationFinder } from "../src/lib/chain";
import { COUNTRIES } from "../src/lib/countries";
import { claimCreateFundNonce } from "../src/lib/create-fund-cap";
import type { Db } from "../src/lib/db/client";
import { createFundNonces, funds, memberships, operations } from "../src/lib/db/schema";
import { MAX_PESOS, formatMoney } from "../src/lib/format";
import { DEFAULT_BALANCE_CAP } from "../src/lib/fund-abi";
import { countryCodeOf, fundCountryOf } from "../src/lib/fund-country";
import {
  NEW_FUND_VERSION,
  cancelDeploy,
  confirmDeploy,
  createDraft,
  deployCall,
  deployStep,
  draftById,
  draftByInvite,
  frozenCreateFunds,
  fundsOf,
  joinFund,
} from "../src/lib/funds";
import { PENDING_FOR_MS, finishOperation, recordOperation } from "../src/lib/operations";
import { addLiveFund, addUser, randomAccount, recordTransactions, testDb } from "./support/db";
import { AGENT, FUND as NEW_FUND, WARS } from "./support/fixtures";
import { en, es } from "./support/messages";

const TX: Hash = pad("0x7a", { size: 32 });
const OP: Hash = pad("0x0b", { size: 32 });
const RESEND: Hash = pad("0x0c", { size: 32 });
const DRAFT = { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: 10_000n * WARS, weeklyCap: 60_000n * WARS };

async function group(db: Db, size = 3) {
  const people = [];
  for (const name of ["Ana", "Beto", "Caro", "Dani"].slice(0, size)) people.push(await addUser(db, name));
  const created = await createDraft(db, people[0]!.id, DRAFT, es);
  if (!created.ok) throw new Error(created.error);
  for (const person of people.slice(1)) await joinFund(db, person.id, created.inviteCode, es);
  return { people, fundId: created.id, inviteCode: created.inviteCode };
}

/**
 * A receipt with these FundCreated logs (version 2's, with the currency indexed and the dollar in the data, if `version`
 * is 2), a chain where every fund has `settings`, and the EntryPoint's nonce for anyone.
 */
function fakeClient(logs: { address: Address; fund: Address; creator: Address }[], settings: unknown[], version: FundVersion = 1) {
  const name = "Fútbol de los jueves";
  return {
    getTransactionReceipt: vi.fn(async (_: { hash: Hash }) => ({
      blockNumber: 79_700_000n,
      status: "success",
      logs: logs.map(({ address, fund, creator }) =>
        version === 1
          ? {
              address,
              topics: encodeEventTopics({ abi: fundFactoryAbi, eventName: "FundCreated", args: { fund, creator } }),
              data: encodeAbiParameters([{ type: "string" }], [name]),
            }
          : {
              address,
              topics: encodeEventTopics({ abi: fundFactoryV2Abi, eventName: "FundCreated", args: { fund, creator, currency: WARS_TOKEN } }),
              data: encodeAbiParameters([{ type: "address" }, { type: "string" }], [USDT, name]),
            },
      ),
    })),
    multicall: vi.fn(async () => settings),
    readContract: vi.fn(async (_: { functionName: string; args: unknown[] }) => 0n),
  };
}

/**
 * What a fund made from DRAFT for `members` with 2 votes returns, in confirmDeploy's multicall order, with one thing
 * changed. A version 2 fund has four more: its currency, dollar, pool and fee.
 */
function settingsFor(members: Address[], change: Partial<Record<string, unknown>> = {}, version: FundVersion = 1) {
  const s = {
    members,
    votesRequired: 2,
    agent: AGENT,
    weeklyCap: 60_000n * WARS,
    balanceCap: 450_000n * WARS,
    name: "Fútbol de los jueves",
    agreedExpense: "la cancha",
    currency: WARS_TOKEN,
    dollar: USDT,
    pool: POOL,
    feeBps: FEE_BPS,
    ...change,
  };
  const v1 = [s.members, s.votesRequired, s.agent, s.weeklyCap, s.balanceCap, s.name, s.agreedExpense];
  return version === 1 ? v1 : [...v1, s.currency, s.dollar, s.pool, s.feeBps];
}

describe("drafts and invitations", () => {
  it("creates a draft with its link, and lists who joined in order", async () => {
    const db = await testDb();
    const { people, inviteCode } = await group(db);
    const draft = await draftByInvite(db, inviteCode);
    expect(draft).toMatchObject({ name: "Fútbol de los jueves", status: "draft", creatorName: "Ana", weeklyFee: 10_000n * WARS });
    expect(draft?.members.map((m) => m.name)).toEqual(["Ana", "Beto", "Caro"]);
    expect(inviteCode).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await joinFund(db, people[1]!.id, inviteCode, es)).toMatchObject({ ok: true }); // joining twice is fine
    expect(await draftByInvite(db, inviteCode).then((d) => d?.members.length)).toBe(3);
    expect(await joinFund(db, people[1]!.id, "nope", es)).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a draft without a name, a fee or a cap, or with an amount nobody means", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    expect(await createDraft(db, ana.id, { ...DRAFT, name: " " }, es)).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, agreedExpense: "x".repeat(41) }, es)).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyFee: 0n }, es)).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyCap: 0n }, es)).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyFee: MAX_PESOS + 1n }, es)).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyCap: MAX_PESOS + 1n }, es)).toMatchObject({ ok: false, status: 400 });
    // A weekly cap can't pass the fund's cap, which is far below the most any amount may be.
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyCap: DEFAULT_BALANCE_CAP + 1n }, es)).toEqual({
      ok: false,
      status: 400,
      error: es.checks.capAboveFundCap(formatMoney(DEFAULT_BALANCE_CAP, es)),
    });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyCap: DEFAULT_BALANCE_CAP }, es)).toMatchObject({ ok: true });
  });

  it("orders people who joined at the same instant by their id, so every reader gets the same list", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    const created = await createDraft(db, ana.id, DRAFT, es);
    if (!created.ok) throw new Error(created.error);
    const others = [await addUser(db, "Beto"), await addUser(db, "Caro"), await addUser(db, "Dani")].map((p) => p.id).sort();
    const sameInstant = new Date(Date.now() + 60_000);
    // Inserted from the highest id down, so the order they went in is not the order they must come out in.
    for (const userId of [...others].reverse()) await db.insert(memberships).values({ fundId: created.id, userId, joinedAt: sameInstant });

    const draft = await draftById(db, created.id);
    expect(draft?.members.map((m) => m.userId)).toEqual([ana.id, ...others]);
    const result = await deployCall(db, { fundId: created.id, userId: ana.id, votesRequired: 2, agent: AGENT, version: 1, m: es });
    if (!result.ok) throw new Error(result.error);
    const { args } = decodeFunctionData({ abi: fundFactoryAbi, data: result.call.data });
    expect(args?.[0]).toMatchObject({ members: draft?.members.map((m) => m.account) });
  });

  it("gives the tenth place to only one of two people who join at once", async () => {
    const db = await testDb();
    const { fundId, inviteCode } = await group(db);
    for (const name of ["Dani", "Eli", "Fede", "Gabi", "Hugo", "Inés"]) await joinFund(db, (await addUser(db, name)).id, inviteCode, es);
    const [juan, kari] = [await addUser(db, "Juan"), await addUser(db, "Kari")];

    // Both read nine before either writes: only the insert itself can tell them apart.
    const results = await Promise.all([joinFund(db, juan.id, inviteCode, es), joinFund(db, kari.id, inviteCode, es)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, status: 409, error: "El fondo ya tiene 10 personas, que es el máximo." });
    expect((await draftById(db, fundId))?.members).toHaveLength(10);
  });

  it("locks the fund's row to join it and to freeze it, so a join and a deploy never interleave", async () => {
    // PGlite runs one statement at a time, so the race itself can't happen here: what keeps it from happening on
    // Neon is that both take the row's lock first, in the same transaction as what they write and read.
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    const transactions = recordTransactions(db);
    const lock = /^select .* from "funds" where "funds"."id" = \$1 for update$/;

    expect(await joinFund(db, (await addUser(db, "Dani")).id, inviteCode, es)).toMatchObject({ ok: true });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toEqual([expect.stringMatching(lock), expect.stringMatching(/^insert into "memberships"/)]);

    expect(await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT, m: es })).toMatchObject({ ok: true });
    expect(transactions).toHaveLength(2);
    expect(transactions[1]).toEqual([
      expect.stringMatching(lock),
      expect.stringMatching(/^update "funds" set/),
      expect.stringMatching(/^select .* from "memberships"/),
    ]);
  });

  it("summarizes a draft with its currency", async () => {
    const db = await testDb();
    const { fundId: draftId } = await group(db);
    expect((await draftById(db, draftId))!.currency).toBe(WARS_TOKEN);
  });

  it("finds nothing for an id that isn't one, instead of failing", async () => {
    const db = await testDb();
    expect(await draftById(db, "nope")).toBeNull();
    expect(await deployCall(db, { fundId: "nope", userId: crypto.randomUUID(), votesRequired: 2, agent: AGENT, m: es })).toMatchObject({ ok: false, status: 404 });
  });

  it("lists a person's funds with their names, live ones first", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    await addLiveFund(db, { creatorId: people[1]!.id, address: NEW_FUND, members: [people[1]!.id, people[0]!.id, people[2]!.id] });
    await db.update(funds).set({ name: "Pádel" }).where(eq(funds.address, NEW_FUND));
    expect(await fundsOf(db, people[0]!.id)).toEqual([
      expect.objectContaining({ status: "live", address: NEW_FUND, name: "Pádel" }),
      { id: fundId, status: "draft", address: null, name: "Fútbol de los jueves" },
    ]);
  });

  it("keeps each group in the order the person joined, whatever order the rows come out of the database in", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    const joinedAt = (fundId: string, minute: number) =>
      db
        .update(memberships)
        .set({ joinedAt: new Date(Date.UTC(2026, 9, 10, 12, minute)) })
        .where(and(eq(memberships.fundId, fundId), eq(memberships.userId, ana.id)));
    const draft = async () => {
      const created = await createDraft(db, ana.id, DRAFT, es);
      if (!created.ok) throw new Error(created.error);
      return created.id;
    };
    // Each pair is made in one order and joined in the other, so the order they were stored in is the wrong one.
    const laterLive = await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
    const earlierLive = await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
    const laterDraft = await draft();
    const earlierDraft = await draft();
    await joinedAt(laterLive.id, 30);
    await joinedAt(earlierLive.id, 10);
    await joinedAt(laterDraft, 40);
    await joinedAt(earlierDraft, 20);
    expect((await fundsOf(db, ana.id)).map((fund) => fund.id)).toEqual([earlierLive.id, laterLive.id, earlierDraft, laterDraft]);
  });

  it("breaks a tie in the join time by the fund's id, so funds joined together never swap places", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    // Six of them, so the order they were stored in is the order of their (random) ids only one time in 720.
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] })).id);
    await db.update(memberships).set({ joinedAt: new Date(Date.UTC(2026, 9, 10, 12, 0)) }).where(eq(memberships.userId, ana.id));
    expect((await fundsOf(db, ana.id)).map((fund) => fund.id)).toEqual([...ids].sort());
  });
});

describe("a fund's country (spec, 6)", () => {
  const MXN = COUNTRIES.MX.currency.token;

  it("is its currency's, whatever its status, and Argentina for an address no fund has", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    const [mexican, argentine] = [randomAccount(), randomAccount()];
    await addLiveFund(db, { creatorId: ana.id, address: mexican, members: [ana.id], version: 2, currency: MXN });
    await addLiveFund(db, { creatorId: ana.id, address: argentine, members: [ana.id] });
    expect(await fundCountryOf(db, mexican)).toBe("MX");
    expect(await fundCountryOf(db, mexican.toLowerCase() as Address)).toBe("MX");
    expect(await fundCountryOf(db, argentine)).toBe("AR");
    expect(await fundCountryOf(db, randomAccount())).toBe("AR");
    await db.update(funds).set({ status: "deploying" }).where(eq(funds.address, mexican));
    expect(await fundCountryOf(db, mexican)).toBe("MX");
  });

  it("is Argentina for a currency without a country here", () => {
    expect(countryCodeOf(MXN)).toBe("MX");
    expect(countryCodeOf(MXN.toLowerCase() as Address)).toBe("MX");
    expect(countryCodeOf(WARS_TOKEN)).toBe("AR");
    expect(countryCodeOf(USDT)).toBe("AR");
  });
});

describe("deployCall", () => {
  it("builds a v1 createFund for the creator, with the members in the order they joined and the votes they chose", async () => {
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    const result = await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT, version: 1, m: es });
    if (!result.ok) throw new Error(result.error);
    expect(result.call.to).toBe(FUND_FACTORY);
    const { args } = decodeFunctionData({ abi: fundFactoryAbi, data: result.call.data });
    expect(args?.[0]).toEqual({
      name: "Fútbol de los jueves",
      members: people.map((p) => getAddress(p.account)),
      votesRequired: 2,
      agent: AGENT,
      agreedExpense: "la cancha",
      weeklyCap: 60_000n * WARS,
      balanceCap: 450_000n * WARS,
    });
    // Nobody joins while it's being created: the chain would get a different list.
    const late = await addUser(db, "Dani");
    expect(await joinFund(db, late.id, inviteCode, es)).toMatchObject({ ok: false, status: 409 });
    expect(await joinFund(db, people[1]!.id, inviteCode, es)).toMatchObject({ ok: true }); // someone already in still gets in
  });

  it("refuses anyone but the creator, fewer than 3 people, and votes outside 2 to members − 1", async () => {
    const db = await testDb();
    const three = await group(db);
    expect(await deployCall(db, { fundId: three.fundId, userId: three.people[1]!.id, votesRequired: 2, agent: AGENT, m: es })).toMatchObject({ ok: false, status: 403 });
    for (const votes of [1, 3, 2.5]) {
      expect(await deployCall(db, { fundId: three.fundId, userId: three.people[0]!.id, votesRequired: votes, agent: AGENT, m: es })).toMatchObject({ ok: false, status: 400 });
    }
    expect((await draftById(db, three.fundId))?.status).toBe("draft"); // a refused call freezes nothing
    const two = await group(db, 2);
    expect(await deployCall(db, { fundId: two.fundId, userId: two.people[0]!.id, votesRequired: 2, agent: AGENT, m: es })).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses more than 10 people, which createFund would always revert", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    for (let i = 0; i < 8; i++) await db.insert(memberships).values({ fundId, userId: (await addUser(db, `P${i}`)).id });
    expect(await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT, m: es })).toEqual({
      ok: false,
      status: 409,
      error: "Un fondo puede tener hasta 10 personas, y este tiene 11.",
    });
    expect((await draftById(db, fundId))?.status).toBe("draft");
  });

  it("keeps the votes a first tab is signing: a second one can't change them while it's being created", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db, 4);
    const call = (votesRequired: number) => deployCall(db, { fundId, userId: people[0]!.id, votesRequired, agent: AGENT, m: es });
    const first = await call(2);
    expect(await call(3)).toEqual({ ok: false, status: 409, error: "Ya empezaste a crear el fondo con 2 votos necesarios: elegí 2 para seguir." });
    expect((await draftById(db, fundId))?.votesRequired).toBe(2);
    expect(await call(2)).toEqual(first); // the same call, as the creator coming back to a closed tab gets
  });
});

describe("the fund's version: v1 `Fund` or v2 `FundV2`, taken when the draft is frozen", () => {
  const deploy = (db: Db, fundId: string, userId: string, version?: FundVersion) =>
    deployCall(db, { fundId, userId, votesRequired: 2, agent: AGENT, ...(version === undefined ? {} : { version }), m: es });
  const versionOf = async (db: Db, fundId: string) => (await db.select({ version: funds.version }).from(funds).where(eq(funds.id, fundId)))[0]?.version;
  const v2Params = (data: Hex) => {
    const decoded = decodeFunctionData({ abi: fundFactoryV2Abi, data });
    return decoded.functionName === "createFund" ? decoded.args[0] : undefined;
  };

  it("a new draft is a v2 fund in wARS, and a draft still open takes v2 when it's frozen", async () => {
    expect(NEW_FUND_VERSION).toBe(2);
    const db = await testDb();
    const { people, fundId } = await group(db);
    expect((await db.select().from(funds).where(eq(funds.id, fundId)))[0]).toMatchObject({
      version: 2,
      currency: WARS_TOKEN,
      balanceCap: DEFAULT_BALANCE_CAP,
    });
    const result = await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT, m: es });
    if (!result.ok) throw new Error(result.error);
    expect(result.call.to).toBe(FUND_FACTORY_V2);
    expect(v2Params(result.call.data)).toEqual({
      name: "Fútbol de los jueves",
      members: people.map((p) => getAddress(p.account)),
      votesRequired: 2,
      agent: AGENT,
      agreedExpense: "la cancha",
      weeklyCap: 60_000n * WARS,
      balanceCap: 450_000n * WARS,
      currency: WARS_TOKEN,
      dollar: USDT,
      pool: POOL,
      feeBps: 25,
    });
    expect(await versionOf(db, fundId)).toBe(2);

    // A draft made when new funds were v1 and still open: frozen now, it takes the version new funds have.
    const old = await group(db);
    await db.update(funds).set({ version: 1 }).where(eq(funds.id, old.fundId));
    const frozen = await deployCall(db, { fundId: old.fundId, userId: old.people[0]!.id, votesRequired: 2, agent: AGENT, m: es });
    expect(frozen).toMatchObject({ ok: true, call: { to: FUND_FACTORY_V2 } });
    expect(await versionOf(db, old.fundId)).toBe(2);
  });

  it("deployCall builds FundFactoryV2's createFund with wARS, USDT, today's pool and a 0.25 % fee", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const result = await deploy(db, fundId, people[0]!.id, 2);
    if (!result.ok) throw new Error(result.error);
    expect(result.call.to).toBe(FUND_FACTORY_V2);
    expect(v2Params(result.call.data)).toEqual({
      name: "Fútbol de los jueves",
      members: people.map((p) => getAddress(p.account)),
      votesRequired: 2,
      agent: AGENT,
      agreedExpense: "la cancha",
      weeklyCap: 60_000n * WARS,
      balanceCap: 450_000n * WARS,
      currency: WARS_TOKEN,
      dollar: USDT,
      pool: POOL,
      feeBps: 25,
    });
    expect(await versionOf(db, fundId)).toBe(2);
  });

  it("a draft frozen with v1 keeps creating in v1", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const first = await deploy(db, fundId, people[0]!.id, 1);
    if (!first.ok) throw new Error(first.error);
    // The same call again (a resend, or the creator coming back to a closed tab), now that new funds are v2.
    const again = await deploy(db, fundId, people[0]!.id, 2);
    expect(again).toEqual(first);
    expect(again).toMatchObject({ ok: true, call: { to: FUND_FACTORY } });
    expect(decodeFunctionData({ abi: fundFactoryAbi, data: first.call.data }).functionName).toBe("createFund");
    expect(await versionOf(db, fundId)).toBe(1);
  });

  it("a draft frozen with v2 keeps creating in v2, whatever the version of new funds is", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const first = await deploy(db, fundId, people[0]!.id, 2);
    if (!first.ok) throw new Error(first.error);
    expect(await deploy(db, fundId, people[0]!.id)).toEqual(first); // the version of new funds is NEW_FUND_VERSION, 2
    expect(await deploy(db, fundId, people[0]!.id, 1)).toEqual(first);
    expect(await versionOf(db, fundId)).toBe(2);
  });

  it("an old draft still open takes the new version when it's frozen", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    await db.update(funds).set({ version: 1 }).where(eq(funds.id, fundId)); // made when new funds were v1
    const result = await deploy(db, fundId, people[0]!.id, 2);
    expect(result).toMatchObject({ ok: true, call: { to: FUND_FACTORY_V2 } });
    expect(await versionOf(db, fundId)).toBe(2);
    // Opened again, it takes the version new funds have by then, since nothing was sent with the one it had.
    expect(await cancelDeploy(db, { fundId, userId: people[0]!.id, m: es })).toEqual({ ok: true, reopened: true });
    expect(await deploy(db, fundId, people[0]!.id, 1)).toMatchObject({ ok: true, call: { to: FUND_FACTORY } });
    expect(await versionOf(db, fundId)).toBe(1);
  });

  it("gives a draft the fee its fund will have, to show before anyone joins it or creates it, and none in version 1", async () => {
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    // Still open, it's created on FundFactoryV2 with the fee deployCall names.
    expect(await draftById(db, fundId)).toMatchObject({ status: "draft", version: 2, feeBps: FEE_BPS });
    expect(await draftByInvite(db, inviteCode)).toMatchObject({ feeBps: FEE_BPS });
    // A draft made when new funds were v1 and still open is frozen as v2 all the same, with the fee.
    await db.update(funds).set({ version: 1 }).where(eq(funds.id, fundId));
    expect(await draftById(db, fundId)).toMatchObject({ status: "draft", version: 1, feeBps: FEE_BPS });
    // Frozen as v1, it has none, and neither has a live v1 fund (the football and barbecue funds); a live v2 one has it.
    await deploy(db, fundId, people[0]!.id, 1);
    expect(await draftById(db, fundId)).toMatchObject({ status: "deploying", version: 1, feeBps: 0 });
    const v1 = await addLiveFund(db, { creatorId: people[0]!.id, address: randomAccount(), members: [people[0]!.id] });
    expect(await draftById(db, v1.id)).toMatchObject({ status: "live", version: 1, feeBps: 0 });
    const v2 = await addLiveFund(db, { creatorId: people[0]!.id, address: randomAccount(), members: [people[0]!.id], version: 2 });
    expect(await draftById(db, v2.id)).toMatchObject({ status: "live", version: 2, feeBps: FEE_BPS });
  });

  it("refuses to freeze as v2 a draft whose weekly cap is above the fund's cap, which FundV2 would revert", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    await db.update(funds).set({ weeklyCap: DEFAULT_BALANCE_CAP + 1n }).where(eq(funds.id, fundId)); // an old draft: createDraft refuses it now
    expect(await deploy(db, fundId, people[0]!.id, 2)).toEqual({
      ok: false,
      status: 400,
      error: es.checks.capAboveFundCap(formatMoney(DEFAULT_BALANCE_CAP, es)),
    });
    expect((await draftById(db, fundId))?.status).toBe("draft"); // nothing was frozen
    // v1 never had that rule: such a draft still creates its v1 fund, and a v1 one already frozen is sent again as it was.
    expect(await deploy(db, fundId, people[0]!.id, 1)).toMatchObject({ ok: true, call: { to: FUND_FACTORY } });
    expect(await deploy(db, fundId, people[0]!.id, 2)).toMatchObject({ ok: true, call: { to: FUND_FACTORY } });
  });

  it("frozenCreateFunds gives each draft's call with its factory", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    const others = [await addUser(db, "Beto"), await addUser(db, "Caro")];
    const draft = async (name: string) => {
      const created = await createDraft(db, ana.id, { ...DRAFT, name }, es);
      if (!created.ok) throw new Error(created.error);
      for (const person of others) await joinFund(db, person.id, created.inviteCode, es);
      return created.id;
    };
    const [futbol, asado] = [await draft("Fútbol"), await draft("Asado")];
    await draft("Pádel"); // never frozen: it has no call
    const calls = [];
    for (const [fundId, version] of [[futbol, 1], [asado, 2]] as const) {
      const frozen = await deploy(db, fundId, ana.id, version);
      if (!frozen.ok) throw new Error(frozen.error);
      calls.push(frozen.call);
    }

    const given = await frozenCreateFunds(db, ana.id, () => AGENT);
    expect(given).toHaveLength(2);
    expect(given).toEqual(expect.arrayContaining(calls));
    expect(given.map((call) => call.to).sort()).toEqual([FUND_FACTORY, FUND_FACTORY_V2].sort());
    expect(await frozenCreateFunds(db, others[0]!.id, () => AGENT)).toEqual([]);
  });

  it("confirmDeploy refuses a v2 fund with another fee", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const members = people.map((p) => getAddress(p.account));
    const creator = members[0]!;
    await deploy(db, fundId, people[0]!.id, 2);
    const confirm = (settings: unknown[]) =>
      confirmDeploy(db, {
        fundId,
        userId: people[0]!.id,
        transactionHash: TX,
        client: fakeClient([{ address: FUND_FACTORY_V2, fund: NEW_FUND, creator }], settings, 2) as never,
        agent: AGENT,
        m: es,
      });
    expect(await confirm(settingsFor(members, { feeBps: 30 }, 2))).toEqual({ ok: false, status: 409, error: es.funds.mismatch });
    expect((await draftById(db, fundId))?.status).toBe("deploying");
    expect(await confirm(settingsFor(members, {}, 2))).toEqual({ ok: true, address: NEW_FUND });
  });

  it("confirmDeploy refuses a v2 fund with another currency, dollar or pool", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const members = people.map((p) => getAddress(p.account));
    const other = getAddress("0x00000000000000000000000000000000000000ff");
    await deploy(db, fundId, people[0]!.id, 2);
    for (const change of [{ currency: other }, { dollar: other }, { pool: other }, { dollar: getAddress("0x0000000000000000000000000000000000000000") }]) {
      const client = fakeClient([{ address: FUND_FACTORY_V2, fund: NEW_FUND, creator: members[0]! }], settingsFor(members, change, 2), 2);
      expect(
        await confirmDeploy(db, { fundId, userId: people[0]!.id, transactionHash: TX, client: client as never, agent: AGENT, m: es }),
        JSON.stringify(Object.keys(change)),
      ).toEqual({ ok: false, status: 409, error: es.funds.mismatch });
    }
    expect((await draftById(db, fundId))?.status).toBe("deploying");
  });

  it("markLive keeps the version of the factory that created it", async () => {
    const db = await testDb();
    const [one, two] = [await group(db), await group(db)];
    const [fundOne, fundTwo] = [getAddress("0x00000000000000000000000000000000000f00d7"), getAddress("0x00000000000000000000000000000000000f00d8")];
    await deploy(db, one.fundId, one.people[0]!.id, 1);
    await deploy(db, two.fundId, two.people[0]!.id, 2);
    const confirm = ({ people, fundId }: typeof one, fund: Address, factory: Address, version: FundVersion) =>
      confirmDeploy(db, {
        fundId,
        userId: people[0]!.id,
        transactionHash: TX,
        client: fakeClient([{ address: factory, fund, creator: getAddress(people[0]!.account) }], settingsFor(people.map((p) => getAddress(p.account)), {}, version), version) as never,
        agent: AGENT,
        m: es,
      });
    // Each takes only its own version's factory: the other one's FundCreated isn't its fund.
    expect(await confirm(one, fundOne, FUND_FACTORY_V2, 2)).toMatchObject({ ok: false, status: 409, error: es.funds.notInOperation });
    expect(await confirm(two, fundTwo, FUND_FACTORY, 1)).toMatchObject({ ok: false, status: 409, error: es.funds.notInOperation });
    expect(await versionOf(db, one.fundId)).toBe(1);
    expect(await versionOf(db, two.fundId)).toBe(2);

    expect(await confirm(one, fundOne, FUND_FACTORY, 1)).toEqual({ ok: true, address: fundOne });
    expect(await confirm(two, fundTwo, FUND_FACTORY_V2, 2)).toEqual({ ok: true, address: fundTwo });
    expect(await draftById(db, one.fundId)).toMatchObject({ status: "live", address: fundOne, version: 1 });
    expect(await draftById(db, two.fundId)).toMatchObject({ status: "live", address: fundTwo, version: 2 });
    expect(await versionOf(db, one.fundId)).toBe(1);
    expect(await versionOf(db, two.fundId)).toBe(2);
  });

  it("deployStep builds, sends again and confirms a v2 createFund on FundFactoryV2, keeping its version", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db, 4);
    const ana = people[0]!.id;
    const members = people.map((p) => getAddress(p.account));
    const step = (client: ReturnType<typeof fakeClient>, version?: FundVersion) =>
      deployStep(db, {
        fundId,
        userId: ana,
        votesRequired: 2,
        agent: AGENT,
        client: client as never,
        findOperation: async () => null,
        createFundDailyLimit: 10,
        ...(version === undefined ? {} : { version }),
        m: es,
      });
    const first = await step(fakeClient([], []), 2);
    expect(first).toMatchObject({ ok: true, call: { to: FUND_FACTORY_V2 } });

    // Sent with nonce 5 a long time ago, and the chain still has that nonce: the same call again, still v2, though
    // this call asks for v1 (the version a draft frozen now would take).
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId, nonce: 5n });
    await db.update(operations).set({ createdAt: new Date(Date.now() - PENDING_FOR_MS - 60_000) });
    const unspent = fakeClient([], []);
    unspent.readContract.mockResolvedValue(5n);
    expect(await step(unspent, 1)).toEqual({ ...first, nonce: 5n });

    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: true });
    const landed = fakeClient([{ address: FUND_FACTORY_V2, fund: NEW_FUND, creator: members[0]! }], settingsFor(members, {}, 2), 2);
    expect(await step(landed)).toEqual({ ok: true, address: NEW_FUND });
    expect(await draftById(db, fundId)).toMatchObject({ status: "live", address: NEW_FUND, version: 2 });
  });
});

describe("cancelDeploy", () => {
  it("opens a draft whose deploy sent nothing, or only failed, to people joining again", async () => {
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    const ana = people[0]!.id;
    const late = await addUser(db, "Dani");

    await deployCall(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT, m: es });
    expect(await cancelDeploy(db, { fundId, userId: people[1]!.id, m: es })).toMatchObject({ ok: false, status: 403 });
    expect(await cancelDeploy(db, { fundId, userId: ana, m: es })).toEqual({ ok: true, reopened: true });
    expect(await draftById(db, fundId)).toMatchObject({ status: "draft", votesRequired: null });

    await deployCall(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT, m: es });
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId });
    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: false });
    expect(await cancelDeploy(db, { fundId, userId: ana, m: es })).toEqual({ ok: true, reopened: true });
    expect(await joinFund(db, late.id, inviteCode, es)).toMatchObject({ ok: true, status: "draft" });
  });

  it("keeps the list frozen while a createFund for it is on its way or went through", async () => {
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    const ana = people[0]!.id;
    const late = await addUser(db, "Dani");
    await deployCall(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT, m: es });
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId });

    expect(await cancelDeploy(db, { fundId, userId: ana, m: es })).toEqual({ ok: true, reopened: false });
    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: true });
    expect(await cancelDeploy(db, { fundId, userId: ana, m: es })).toEqual({ ok: true, reopened: false });
    expect(await draftById(db, fundId)).toMatchObject({ status: "deploying", votesRequired: 2 });
    expect(await joinFund(db, late.id, inviteCode, es)).toMatchObject({ ok: false, status: 409 });
  });
});

// These drafts are frozen as v1 and confirmed on FundFactory, the funds already live; a v2 one is confirmed in the fund's version tests above.
describe("confirmDeploy", () => {
  it("goes live only with the factory's fund for this creator, with the draft's exact settings", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const other = await group(db); // another group's draft, there before any confirmation: it must stay untouched
    const creator = getAddress(people[0]!.account);
    const members = people.map((p) => getAddress(p.account));
    await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT, version: 1, m: es });
    const confirm = (client: ReturnType<typeof fakeClient>, userId = people[0]!.id) =>
      confirmDeploy(db, { fundId, userId, transactionHash: TX, client: client as never, agent: AGENT, factory: FUND_FACTORY, m: es });

    expect(await confirm(fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator: members[1]! }], settingsFor(members)))).toMatchObject({ ok: false, status: 409 });
    const impostor = getAddress("0x00000000000000000000000000000000000000ff");
    expect(await confirm(fakeClient([{ address: impostor, fund: NEW_FUND, creator }], settingsFor(members)))).toMatchObject({ ok: false, status: 409 });
    expect(await confirm(fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members, { agent: impostor })))).toMatchObject({ ok: false, status: 409 });
    expect(await confirm(fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor([...members].reverse())))).toMatchObject({ ok: false, status: 409 });
    expect(await confirm(fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members)), people[1]!.id)).toMatchObject({ ok: false, status: 403 });
    expect((await draftById(db, fundId))?.status).toBe("deploying");

    expect(await confirm(fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members)))).toEqual({ ok: true, address: NEW_FUND });
    expect(await draftById(db, fundId)).toMatchObject({ status: "live", address: NEW_FUND });
    expect((await draftById(db, other.fundId))?.status).toBe("draft");
    expect((await db.select({ block: funds.createdBlock }).from(funds)).map((f) => f.block)).toContain(79_700_000n);
  });

  it("reads again a transaction the node doesn't have yet, and goes live once it does", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const members = people.map((p) => getAddress(p.account));
    await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT, version: 1, m: es });
    // The bundler saw it land; our node is two reads behind.
    const lagging = fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator: members[0]! }], settingsFor(members));
    lagging.getTransactionReceipt.mockRejectedValueOnce(new Error("receipt not found")).mockRejectedValueOnce(new Error("receipt not found"));
    const wait = { tries: 5, everyMs: 0 };
    expect(
      await confirmDeploy(db, { fundId, userId: people[0]!.id, transactionHash: TX, client: lagging as never, agent: AGENT, factory: FUND_FACTORY, wait, m: es }),
    ).toEqual({ ok: true, address: NEW_FUND });
    expect(lagging.getTransactionReceipt).toHaveBeenCalledTimes(3);
    expect(await draftById(db, fundId)).toMatchObject({ status: "live", address: NEW_FUND });
  });

  it("answers that it isn't confirmed only after its tries, and keeps the draft being created", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT, version: 1, m: es });
    const unreachable = fakeClient([], []);
    unreachable.getTransactionReceipt.mockRejectedValue(new Error("receipt not found"));
    const wait = { tries: 3, everyMs: 0 };
    expect(
      await confirmDeploy(db, { fundId, userId: people[0]!.id, transactionHash: TX, client: unreachable as never, agent: AGENT, factory: FUND_FACTORY, wait, m: es }),
    ).toMatchObject({ ok: false, status: 409, error: "La operación todavía no se confirmó. Probá en un rato." });
    expect(unreachable.getTransactionReceipt).toHaveBeenCalledTimes(3);
    expect((await draftById(db, fundId))?.status).toBe("deploying");
  });
});

describe("deployStep", () => {
  async function deploying(db: Db) {
    const { people, fundId } = await group(db, 4); // four, so 2 and 3 votes are both valid
    const ana = people[0]!.id;
    const members = people.map((p) => getAddress(p.account));
    /** The chain's log search for UserOperationEvents: by default, it finds nothing. */
    const findOperation = vi.fn<UserOperationFinder>(async () => null);
    // A v1 draft, to FundFactory: the version-2 flow is in the tests of the fund's version above.
    const step = (client: ReturnType<typeof fakeClient>, votesRequired = 2, createFundDailyLimit = 10) =>
      deployStep(db, { fundId, userId: ana, votesRequired, agent: AGENT, client: client as never, findOperation, createFundDailyLimit, factory: FUND_FACTORY, version: 1, m: es });
    /** Ana's createFund for the draft went out with nonce 5, and its receipt says `success` (none yet if undefined). */
    const sent = async (success?: boolean) => {
      await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId, nonce: 5n });
      if (success !== undefined) await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success });
    };
    /** What's recorded so far went out longer ago than PENDING_FOR_MS. */
    const longAgo = () => db.update(operations).set({ createdAt: new Date(Date.now() - PENDING_FOR_MS - 60_000) });
    /** A chain where the EntryPoint's nonce for Ana's account is `nonce`. */
    const chainAt = (nonce: bigint) => {
      const client = fakeClient([], []);
      client.readContract.mockResolvedValue(nonce);
      return client;
    };
    return { ana, fundId, members, creator: members[0]!, step, sent, longAgo, chainAt, findOperation };
  }

  /** The votes a createFund call asks for. */
  function votesIn(result: unknown): number | undefined {
    const { call } = result as { call?: { data: Hex } };
    if (call === undefined) return undefined;
    const { args } = decodeFunctionData({ abi: fundFactoryAbi, data: call.data });
    return (args?.[0] as { votesRequired: number }).votesRequired;
  }

  it("builds a new createFund when none was sent for the draft", async () => {
    const db = await testDb();
    const { step } = await deploying(db);
    const client = fakeClient([], []);
    expect(await step(client)).toMatchObject({ ok: true, call: { to: FUND_FACTORY } });
    expect(client.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("confirms with the createFund already sent instead of sending another", async () => {
    const db = await testDb();
    const { ana, fundId, members, creator, step } = await deploying(db);
    await step(fakeClient([], []));
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId });
    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: true });

    const client = fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members));
    expect(await step(client)).toEqual({ ok: true, address: NEW_FUND });
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash: TX });
    expect(await draftById(db, fundId)).toMatchObject({ status: "live", address: NEW_FUND });
    expect(await step(fakeClient([], []))).toEqual({ ok: true, address: NEW_FUND }); // and from then on, it's live
  });

  it("sends the browser to the bundler for an operation that has no receipt yet", async () => {
    const db = await testDb();
    const { ana, fundId, step } = await deploying(db);
    await step(fakeClient([], []));
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId });
    expect(await step(fakeClient([], []))).toEqual({ ok: true, pending: OP });
  });

  it("never sends another while the sent one's transaction can't be read", async () => {
    const db = await testDb();
    const { ana, fundId, step } = await deploying(db);
    await step(fakeClient([], []));
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId });
    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: true });
    const unreachable = fakeClient([], []);
    unreachable.getTransactionReceipt.mockRejectedValue(new Error("receipt not found"));
    expect(await step(unreachable)).toMatchObject({ ok: false, status: 409 });
  });

  it("builds a new one, with the votes chosen now, when the sent one created no fund at all", async () => {
    const db = await testDb();
    const { step, sent } = await deploying(db);
    await step(fakeClient([], []));
    await sent(false);
    expect(votesIn(await step(fakeClient([], []), 3))).toBe(3);
  });

  it("never builds another when the sent one created a fund for this creator, even with other settings", async () => {
    const db = await testDb();
    const { fundId, members, creator, step, sent } = await deploying(db);
    await step(fakeClient([], []));
    await sent(true);
    // A second tab, or anything else, left the chain with a fund the draft doesn't describe: it's still a real one.
    const other = fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members, { votesRequired: 3 }));
    for (const votes of [2, 3]) expect(await step(other, votes)).toMatchObject({ ok: false, status: 409 });
    expect(await draftById(db, fundId)).toMatchObject({ status: "deploying", votesRequired: 2 });
  });

  it("ignores the votes asked for once one was sent: the sent one keeps its own", async () => {
    const db = await testDb();
    const { ana, members, creator, step, sent } = await deploying(db);
    await step(fakeClient([], []), 2);
    await sent();
    expect(await step(fakeClient([], []), 3)).toEqual({ ok: true, pending: OP });
    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: true });
    const fund = fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members));
    expect(await step(fund, 3)).toEqual({ ok: true, address: NEW_FUND });
  });

  it("never releases one whose nonce the chain already spent: it landed, even if nobody recorded it", async () => {
    const db = await testDb();
    const { ana, fundId, creator, step, sent, longAgo, chainAt } = await deploying(db);
    await step(fakeClient([], []));
    await sent();
    await longAgo(); // and the bundler's window for its receipt is long gone
    const chain = chainAt(6n);
    expect(await step(chain, 3)).toEqual({ ok: true, pending: OP });
    expect(chain.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "getNonce", args: [creator, 0n] }));
    expect(await draftById(db, fundId)).toMatchObject({ status: "deploying", votesRequired: 2 });
    expect(await cancelDeploy(db, { fundId, userId: ana, m: es })).toEqual({ ok: true, reopened: false });
  });

  it("finds one that landed after the bundler forgot it on the chain itself, records it, and goes live with its fund", async () => {
    const db = await testDb();
    const { fundId, members, creator, step, sent, longAgo, findOperation } = await deploying(db);
    await step(fakeClient([], []));
    await sent();
    await longAgo(); // the bundler only looks about 2,000 blocks back: it would answer "not found" forever
    const [row] = await db.select().from(operations);
    findOperation.mockResolvedValueOnce({ userOpHash: OP, transactionHash: TX, success: true });
    const chain = fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members));
    chain.readContract.mockResolvedValue(6n); // its nonce is spent

    expect(await step(chain)).toEqual({ ok: true, address: NEW_FUND });
    expect(findOperation).toHaveBeenCalledWith({ userOpHashes: [OP], since: row!.createdAt });
    expect(chain.getTransactionReceipt).toHaveBeenCalledWith({ hash: TX });
    expect(await db.select({ transactionHash: operations.transactionHash, success: operations.success }).from(operations)).toEqual([
      { transactionHash: TX, success: true },
    ]);
    expect(await draftById(db, fundId)).toMatchObject({ status: "live", address: NEW_FUND });
    expect(await step(fakeClient([], []))).toEqual({ ok: true, address: NEW_FUND });
    expect(findOperation).toHaveBeenCalledTimes(1);
  });

  it("opens the draft for a new one when the one found on the chain failed", async () => {
    const db = await testDb();
    const { fundId, step, sent, longAgo, chainAt, findOperation } = await deploying(db);
    await step(fakeClient([], []));
    await sent();
    await longAgo();
    findOperation.mockResolvedValueOnce({ userOpHash: OP, transactionHash: TX, success: false });
    const fresh = await step(chainAt(6n), 3);
    expect(votesIn(fresh)).toBe(3);
    expect(fresh).not.toHaveProperty("nonce");
    expect(await db.select({ success: operations.success }).from(operations)).toEqual([{ success: false }]);
    expect(await draftById(db, fundId)).toMatchObject({ status: "deploying", votesRequired: 3 });
  });

  it("looks for every operation pinned to that nonce: the one that never came back may land instead of its resend", async () => {
    const db = await testDb();
    const { ana, fundId, members, creator, step, sent, longAgo, chainAt, findOperation } = await deploying(db);
    await step(fakeClient([], []));
    await sent();
    await longAgo();
    await step(chainAt(5n)); // released
    await recordOperation(db, ana, { userOpHash: RESEND, kind: "create-fund", draftId: fundId, nonce: 5n });
    await longAgo();
    findOperation.mockResolvedValueOnce({ userOpHash: OP, transactionHash: TX, success: true });
    const chain = fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members));
    chain.readContract.mockResolvedValue(6n);

    expect(await step(chain)).toEqual({ ok: true, address: NEW_FUND });
    const [query] = findOperation.mock.calls[0]!;
    expect([...query.userOpHashes].sort()).toEqual([OP, RESEND].sort());
    const rows = await db.select({ userOpHash: operations.userOpHash, transactionHash: operations.transactionHash }).from(operations);
    expect(rows).toContainEqual({ userOpHash: OP, transactionHash: TX });
  });

  it("stays on its way while the chain shows nothing of it yet, or can't be read", async () => {
    const db = await testDb();
    const { fundId, step, sent, longAgo, chainAt, findOperation } = await deploying(db);
    await step(fakeClient([], []));
    await sent();
    await longAgo();
    expect(await step(chainAt(6n))).toEqual({ ok: true, pending: OP });
    findOperation.mockRejectedValueOnce(new Error("eth_getLogs: too many requests"));
    expect(await step(chainAt(6n))).toEqual({ ok: true, pending: OP });
    expect(await draftById(db, fundId)).toMatchObject({ status: "deploying" });
  });

  it("releases one that never came back while the chain still has its nonce: the same call, pinned to that nonce", async () => {
    const db = await testDb();
    const { step, sent, longAgo, chainAt } = await deploying(db);
    const first = await step(fakeClient([], []), 2);
    await sent();
    await longAgo();
    expect(await step(chainAt(5n), 3)).toEqual({ ...first, nonce: 5n }); // the votes it was frozen with, not the ones asked now
  });

  it("checks the chain every time: a nonce that moved since the last check stops the release", async () => {
    const db = await testDb();
    const { step, sent, longAgo } = await deploying(db);
    await step(fakeClient([], []));
    await sent();
    await longAgo();
    const chain = fakeClient([], []);
    chain.readContract.mockResolvedValueOnce(5n).mockResolvedValueOnce(6n);
    expect(await step(chain)).toMatchObject({ ok: true, nonce: 5n });
    expect(await step(chain)).toEqual({ ok: true, pending: OP });
  });

  it("never releases one too recent, or one sent before nonces were kept", async () => {
    const db = await testDb();
    const { step, sent, longAgo, chainAt } = await deploying(db);
    await step(fakeClient([], []));
    await sent();
    const chain = chainAt(5n);
    expect(await step(chain)).toEqual({ ok: true, pending: OP });
    await db.update(operations).set({ nonce: null });
    await longAgo();
    expect(await step(chain)).toEqual({ ok: true, pending: OP });
    expect(chain.readContract).not.toHaveBeenCalled();
  });

  it("takes one as spent once its pinned resend went through and failed, and opens the draft for a new one", async () => {
    const db = await testDb();
    const { ana, fundId, step, sent, longAgo, chainAt } = await deploying(db);
    await step(fakeClient([], []));
    await sent();
    await longAgo();
    await step(chainAt(5n)); // released
    await recordOperation(db, ana, { userOpHash: RESEND, kind: "create-fund", draftId: fundId, nonce: 5n });
    await finishOperation(db, ana, { userOpHash: RESEND, transactionHash: TX, success: false });
    const fresh = await step(fakeClient([], []), 3);
    expect(votesIn(fresh)).toBe(3);
    expect(fresh).not.toHaveProperty("nonce");
  });

  it("builds nothing when the draft can't open again: another createFund for it is still on its way", async () => {
    const db = await testDb();
    const { ana, fundId, step } = await deploying(db);
    await step(fakeClient([], []));
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId }); // no receipt, no nonce
    await db.update(operations).set({ createdAt: new Date(Date.now() - 60_000) });
    await recordOperation(db, ana, { userOpHash: RESEND, kind: "create-fund", draftId: fundId, nonce: 5n });
    await finishOperation(db, ana, { userOpHash: RESEND, transactionHash: TX, success: false });
    // With the votes it's frozen with, so only this check (not the votes one) can stop the build.
    expect(await step(fakeClient([], []), 2)).toEqual({ ok: false, status: 409, error: "El fondo se está creando en este momento. Probá en un rato." });
    expect(await draftById(db, fundId)).toMatchObject({ status: "deploying", votesRequired: 2 });
  });

  describe("the paymaster's createFund caps, checked before anything is frozen (M5)", () => {
    it("says the creator used up their 3 tries on the nonce the chain has now, and leaves the draft open", async () => {
      const db = await testDb();
      const { ana, fundId, creator, step, chainAt } = await deploying(db);
      await step(chainAt(0n)); // an earlier click froze it, and its page closed before sending anything
      expect(await draftById(db, fundId)).toMatchObject({ status: "deploying" });
      for (const nonce of [0n, 1n, 2n]) await claimCreateFundNonce(db, ana, nonce, 10);
      const chain = chainAt(3n);
      expect(await step(chain)).toEqual({
        ok: false,
        status: 429,
        error: "Tu cuenta ya usó los 3 intentos de crear un fondo que paga TesorerIA. Escribinos y lo destrabamos.",
      });
      expect(chain.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "getNonce", args: [creator, 0n] }));
      expect(await draftById(db, fundId)).toMatchObject({ status: "draft" });
    });

    it("says the day's createFunds ran out, under the limit it's given, and leaves the draft open", async () => {
      const db = await testDb();
      const { fundId, step, chainAt } = await deploying(db);
      for (const name of ["Eli", "Fede"]) await claimCreateFundNonce(db, (await addUser(db, name)).id, 0n, 2);
      expect(await step(chainAt(0n), 2, 2)).toEqual({
        ok: false,
        status: 429,
        error: "Hoy ya se crearon muchos fondos en TesorerIA. Probá de nuevo mañana.",
      });
      expect(await draftById(db, fundId)).toMatchObject({ status: "draft" });
      expect(await step(chainAt(0n), 2, 3)).toMatchObject({ ok: true, call: { to: FUND_FACTORY } }); // a higher limit, at once
    });

    it("still builds the call on a nonce the paymaster already signed for the creator: it can't land twice", async () => {
      const db = await testDb();
      const { ana, step, chainAt } = await deploying(db);
      for (const nonce of [0n, 1n, 2n]) await claimCreateFundNonce(db, ana, nonce, 10);
      expect(await step(chainAt(2n))).toMatchObject({ ok: true, call: { to: FUND_FACTORY } });
    });

    it("builds the call when the chain's nonce can't be read: the paymaster still holds the caps", async () => {
      const db = await testDb();
      const { ana, step } = await deploying(db);
      for (const nonce of [0n, 1n, 2n]) await claimCreateFundNonce(db, ana, nonce, 10);
      const down = fakeClient([], []);
      down.readContract.mockRejectedValue(new Error("RPC Request failed."));
      expect(await step(down)).toMatchObject({ ok: true, call: { to: FUND_FACTORY } });
    });
  });
});

describe("agentAddress", () => {
  it("names AGENT_ADDRESS without a key, the key's address on the fork, and stops on mainnet for any other key", () => {
    expect(agentAddress({ CHAIN_MODE: "mainnet", AGENT_PRIVATE_KEY: undefined })).toBe(AGENT_ADDRESS);
    const key = generatePrivateKey();
    expect(agentAddress({ CHAIN_MODE: "fork", AGENT_PRIVATE_KEY: key })).toBe(privateKeyToAddress(key));
    expect(() => agentAddress({ CHAIN_MODE: "mainnet", AGENT_PRIVATE_KEY: key })).toThrow(/AGENT_ADDRESS/);
  });
});

describe("in the language of the dictionary", () => {
  it("answers an invitation and a draft in English, and the same ones in Spanish", async () => {
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    const ana = people[0]!.id;
    expect(await joinFund(db, people[1]!.id, "nope", en)).toEqual({ ok: false, status: 404, error: en.funds.badInvite });
    expect(await joinFund(db, people[1]!.id, "nope", es)).toEqual({ ok: false, status: 404, error: "Ese link de invitación no es válido." });
    expect(en.funds.badInvite).toBe("That invitation link isn't valid.");

    expect(await createDraft(db, ana, { ...DRAFT, name: " " }, en)).toEqual({ ok: false, status: 400, error: en.checks.fundName });
    expect(await createDraft(db, ana, { ...DRAFT, weeklyFee: MAX_PESOS + 1n }, en)).toEqual({
      ok: false,
      status: 400,
      error: en.checks.feeTooBig(formatMoney(MAX_PESOS, en)),
    });

    // A fund that is being created takes nobody else, and one that is live takes their request (spec, 9.4).
    await deployCall(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT, m: es });
    const late = await addUser(db, "Dani");
    expect(await joinFund(db, late.id, inviteCode, en)).toEqual({ ok: false, status: 409, error: en.funds.beingCreated });
    expect(await joinFund(db, late.id, inviteCode, es)).toEqual({
      ok: false,
      status: 409,
      error: "El fondo se está creando en este momento. Probá en un rato.",
    });
    await db.update(funds).set({ status: "live", address: NEW_FUND }).where(eq(funds.id, fundId));
    expect(await joinFund(db, late.id, inviteCode, en)).toEqual({ ok: true, fundId, status: "requested", address: NEW_FUND });
  });

  it("answers the deploy in English: who may, how many people, how many votes", async () => {
    const db = await testDb();
    const three = await group(db);
    const call = (fundId: string, userId: string, votesRequired: number, m = en) => deployCall(db, { fundId, userId, votesRequired, agent: AGENT, m });
    const refused = (status: number, error: string) => ({ ok: false, status, error });

    expect(await call("nope", three.people[0]!.id, 2)).toEqual(refused(404, en.errors.fundNotFound));
    expect(await call("nope", three.people[0]!.id, 2, es)).toEqual(refused(404, "No encontramos ese fondo."));
    expect(await call(three.fundId, three.people[1]!.id, 2)).toEqual(refused(403, en.funds.onlyCreator));
    expect(await call(three.fundId, three.people[0]!.id, 1)).toEqual(refused(400, "With 3 people, the votes needed go from 2 to 2."));
    expect(await call(three.fundId, three.people[0]!.id, 1, es)).toEqual(refused(400, "Con 3 personas, los votos necesarios van de 2 a 2."));
    const two = await group(db, 2);
    expect(await call(two.fundId, two.people[0]!.id, 2)).toEqual(refused(409, en.funds.tooFewMembers));

    const big = await group(db);
    for (let i = 0; i < 8; i++) await db.insert(memberships).values({ fundId: big.fundId, userId: (await addUser(db, `P${i}`)).id });
    expect(await call(big.fundId, big.people[0]!.id, 2)).toEqual(refused(409, "A fund can have up to 10 people, and this one has 11."));

    const four = await group(db, 4);
    await call(four.fundId, four.people[0]!.id, 2);
    expect(await call(four.fundId, four.people[0]!.id, 3)).toEqual(
      refused(409, "You've already started creating the fund with 2 votes needed: pick 2 to continue."),
    );
    expect(await cancelDeploy(db, { fundId: four.fundId, userId: four.people[1]!.id, m: en })).toEqual(refused(403, en.funds.onlyCreator));
    expect(await cancelDeploy(db, { fundId: "nope", userId: four.people[0]!.id, m: en })).toEqual(refused(404, en.errors.fundNotFound));
  });

  it("answers the confirmation in English: not created yet, not confirmed, not there, another fund", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const ana = people[0]!.id;
    const members = people.map((p) => getAddress(p.account));
    const creator = members[0]!;
    const confirm = (client: ReturnType<typeof fakeClient>, m = en) =>
      confirmDeploy(db, { fundId, userId: ana, transactionHash: TX, client: client as never, agent: AGENT, factory: FUND_FACTORY, wait: { tries: 1, everyMs: 0 }, m });
    const refused = (error: string) => ({ ok: false, status: 409, error });

    expect(await confirm(fakeClient([], []))).toEqual(refused(en.funds.createFirst));
    await deployCall(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT, version: 1, m: es });
    expect(await confirm(fakeClient([], []))).toEqual(refused(en.funds.notInOperation));
    expect(await confirm(fakeClient([], []), es)).toEqual(refused("No encontramos el fondo en esa operación."));
    expect(await confirm(fakeClient([{ address: FUND_FACTORY, fund: NEW_FUND, creator }], settingsFor(members, { votesRequired: 3 })))).toEqual(
      refused(en.funds.mismatch),
    );
    const unreachable = fakeClient([], []);
    unreachable.getTransactionReceipt.mockRejectedValue(new Error("receipt not found"));
    expect(await confirm(unreachable)).toEqual(refused(en.funds.unconfirmed));
  });

  it("says in English that the creator reached a cap, naming how many tries it was", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db, 4);
    const ana = people[0]!.id;
    for (const nonce of [0n, 1n, 2n]) await claimCreateFundNonce(db, ana, nonce, 10);
    const client = fakeClient([], []);
    client.readContract.mockResolvedValue(3n);
    const findOperation = vi.fn<UserOperationFinder>(async () => null);
    const step = (createFundDailyLimit: number, m = en) =>
      deployStep(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT, client: client as never, findOperation, createFundDailyLimit, factory: FUND_FACTORY, m });
    expect(await step(10)).toEqual({
      ok: false,
      status: 429,
      error: "Your account has already used its 3 tries to create a fund that TesorerIA pays for. Write to us and we'll unblock it.",
    });
    expect(await step(10, es)).toEqual({
      ok: false,
      status: 429,
      error: "Tu cuenta ya usó los 3 intentos de crear un fondo que paga TesorerIA. Escribinos y lo destrabamos.",
    });
    await db.delete(createFundNonces);
    for (const person of ["Eli", "Fede"]) await claimCreateFundNonce(db, (await addUser(db, person)).id, 0n, 2);
    client.readContract.mockResolvedValue(0n);
    expect(await step(2)).toEqual({ ok: false, status: 429, error: "Many funds were created in TesorerIA today already. Try again tomorrow." });
  });
});
