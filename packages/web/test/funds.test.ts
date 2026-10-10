import { AGENT_ADDRESS, FUND_FACTORY, fundFactoryAbi } from "@tesoreria/agent";
import { type Address, type Hash, type Hex, decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, pad } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { agentAddress } from "../src/lib/agent-address";
import type { UserOperationFinder } from "../src/lib/chain";
import type { Db } from "../src/lib/db/client";
import { funds, memberships, operations } from "../src/lib/db/schema";
import { MAX_PESOS } from "../src/lib/format";
import {
  cancelDeploy,
  confirmDeploy,
  createDraft,
  deployCall,
  deployStep,
  draftById,
  draftByInvite,
  fundsOf,
  joinFund,
} from "../src/lib/funds";
import { PENDING_FOR_MS, finishOperation, recordOperation } from "../src/lib/operations";
import { addLiveFund, addUser, testDb } from "./support/db";
import { AGENT, FUND as NEW_FUND, WARS } from "./support/fixtures";

const TX: Hash = pad("0x7a", { size: 32 });
const OP: Hash = pad("0x0b", { size: 32 });
const RESEND: Hash = pad("0x0c", { size: 32 });
const DRAFT = { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: 10_000n * WARS, weeklyCap: 60_000n * WARS };

async function group(db: Db, size = 3) {
  const people = [];
  for (const name of ["Ana", "Beto", "Caro", "Dani"].slice(0, size)) people.push(await addUser(db, name));
  const created = await createDraft(db, people[0]!.id, DRAFT);
  if (!created.ok) throw new Error(created.error);
  for (const person of people.slice(1)) await joinFund(db, person.id, created.inviteCode);
  return { people, fundId: created.id, inviteCode: created.inviteCode };
}

/** The statements of each transaction `db` runs from now on, in order (PGlite's own transactions, under drizzle's). */
function recordTransactions(db: Db): string[][] {
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

/** A receipt with these FundCreated logs, a chain where every fund has `settings`, and the EntryPoint's nonce for anyone. */
function fakeClient(logs: { address: Address; fund: Address; creator: Address }[], settings: unknown[]) {
  return {
    getTransactionReceipt: vi.fn(async (_: { hash: Hash }) => ({
      blockNumber: 79_700_000n,
      status: "success",
      logs: logs.map(({ address, fund, creator }) => ({
        address,
        topics: encodeEventTopics({ abi: fundFactoryAbi, eventName: "FundCreated", args: { fund, creator } }),
        data: encodeAbiParameters([{ type: "string" }], ["Fútbol de los jueves"]),
      })),
    })),
    multicall: vi.fn(async () => settings),
    readContract: vi.fn(async (_: { functionName: string; args: unknown[] }) => 0n),
  };
}

/** What a fund made from DRAFT for `members` with 2 votes returns, in confirmDeploy's multicall order, with one thing changed. */
function settingsFor(members: Address[], change: Partial<Record<string, unknown>> = {}) {
  const s = { members, votesRequired: 2, agent: AGENT, weeklyCap: 60_000n * WARS, balanceCap: 450_000n * WARS, name: "Fútbol de los jueves", agreedExpense: "la cancha", ...change };
  return [s.members, s.votesRequired, s.agent, s.weeklyCap, s.balanceCap, s.name, s.agreedExpense];
}

describe("drafts and invitations", () => {
  it("creates a draft with its link, and lists who joined in order", async () => {
    const db = await testDb();
    const { people, inviteCode } = await group(db);
    const draft = await draftByInvite(db, inviteCode);
    expect(draft).toMatchObject({ name: "Fútbol de los jueves", status: "draft", creatorName: "Ana", weeklyFee: 10_000n * WARS });
    expect(draft?.members.map((m) => m.name)).toEqual(["Ana", "Beto", "Caro"]);
    expect(inviteCode).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await joinFund(db, people[1]!.id, inviteCode)).toMatchObject({ ok: true }); // joining twice is fine
    expect(await draftByInvite(db, inviteCode).then((d) => d?.members.length)).toBe(3);
    expect(await joinFund(db, people[1]!.id, "nope")).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a draft without a name, a fee or a cap, or with an amount nobody means", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    expect(await createDraft(db, ana.id, { ...DRAFT, name: " " })).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, agreedExpense: "x".repeat(41) })).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyFee: 0n })).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyCap: 0n })).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyFee: MAX_PESOS + 1n })).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyCap: MAX_PESOS + 1n })).toMatchObject({ ok: false, status: 400 });
    expect(await createDraft(db, ana.id, { ...DRAFT, weeklyCap: MAX_PESOS })).toMatchObject({ ok: true });
  });

  it("orders people who joined at the same instant by their id, so every reader gets the same list", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    const created = await createDraft(db, ana.id, DRAFT);
    if (!created.ok) throw new Error(created.error);
    const others = [await addUser(db, "Beto"), await addUser(db, "Caro"), await addUser(db, "Dani")].map((p) => p.id).sort();
    const sameInstant = new Date(Date.now() + 60_000);
    // Inserted from the highest id down, so the order they went in is not the order they must come out in.
    for (const userId of [...others].reverse()) await db.insert(memberships).values({ fundId: created.id, userId, joinedAt: sameInstant });

    const draft = await draftById(db, created.id);
    expect(draft?.members.map((m) => m.userId)).toEqual([ana.id, ...others]);
    const result = await deployCall(db, { fundId: created.id, userId: ana.id, votesRequired: 2, agent: AGENT });
    if (!result.ok) throw new Error(result.error);
    const { args } = decodeFunctionData({ abi: fundFactoryAbi, data: result.call.data });
    expect(args?.[0]).toMatchObject({ members: draft?.members.map((m) => m.account) });
  });

  it("gives the tenth place to only one of two people who join at once", async () => {
    const db = await testDb();
    const { fundId, inviteCode } = await group(db);
    for (const name of ["Dani", "Eli", "Fede", "Gabi", "Hugo", "Inés"]) await joinFund(db, (await addUser(db, name)).id, inviteCode);
    const [juan, kari] = [await addUser(db, "Juan"), await addUser(db, "Kari")];

    // Both read nine before either writes: only the insert itself can tell them apart.
    const results = await Promise.all([joinFund(db, juan.id, inviteCode), joinFund(db, kari.id, inviteCode)]);
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

    expect(await joinFund(db, (await addUser(db, "Dani")).id, inviteCode)).toMatchObject({ ok: true });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toEqual([expect.stringMatching(lock), expect.stringMatching(/^insert into "memberships"/)]);

    expect(await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT })).toMatchObject({ ok: true });
    expect(transactions).toHaveLength(2);
    expect(transactions[1]).toEqual([
      expect.stringMatching(lock),
      expect.stringMatching(/^update "funds" set/),
      expect.stringMatching(/^select .* from "memberships"/),
    ]);
  });

  it("finds nothing for an id that isn't one, instead of failing", async () => {
    const db = await testDb();
    expect(await draftById(db, "nope")).toBeNull();
    expect(await deployCall(db, { fundId: "nope", userId: crypto.randomUUID(), votesRequired: 2, agent: AGENT })).toMatchObject({ ok: false, status: 404 });
  });

  it("lists a person's funds, live ones first", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    await addLiveFund(db, { creatorId: people[1]!.id, address: NEW_FUND, members: [people[1]!.id, people[0]!.id, people[2]!.id] });
    expect(await fundsOf(db, people[0]!.id)).toEqual([
      expect.objectContaining({ status: "live", address: NEW_FUND }),
      { id: fundId, status: "draft", address: null },
    ]);
  });
});

describe("deployCall", () => {
  it("builds createFund for the creator, with the members in the order they joined and the votes they chose", async () => {
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    const result = await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT });
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
    expect(await joinFund(db, late.id, inviteCode)).toMatchObject({ ok: false, status: 409 });
    expect(await joinFund(db, people[1]!.id, inviteCode)).toMatchObject({ ok: true }); // someone already in still gets in
  });

  it("refuses anyone but the creator, fewer than 3 people, and votes outside 2 to members − 1", async () => {
    const db = await testDb();
    const three = await group(db);
    expect(await deployCall(db, { fundId: three.fundId, userId: three.people[1]!.id, votesRequired: 2, agent: AGENT })).toMatchObject({ ok: false, status: 403 });
    for (const votes of [1, 3, 2.5]) {
      expect(await deployCall(db, { fundId: three.fundId, userId: three.people[0]!.id, votesRequired: votes, agent: AGENT })).toMatchObject({ ok: false, status: 400 });
    }
    expect((await draftById(db, three.fundId))?.status).toBe("draft"); // a refused call freezes nothing
    const two = await group(db, 2);
    expect(await deployCall(db, { fundId: two.fundId, userId: two.people[0]!.id, votesRequired: 2, agent: AGENT })).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses more than 10 people, which createFund would always revert", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    for (let i = 0; i < 8; i++) await db.insert(memberships).values({ fundId, userId: (await addUser(db, `P${i}`)).id });
    expect(await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT })).toEqual({
      ok: false,
      status: 409,
      error: "Un fondo puede tener hasta 10 personas, y este tiene 11.",
    });
    expect((await draftById(db, fundId))?.status).toBe("draft");
  });

  it("keeps the votes a first tab is signing: a second one can't change them while it's being created", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db, 4);
    const call = (votesRequired: number) => deployCall(db, { fundId, userId: people[0]!.id, votesRequired, agent: AGENT });
    const first = await call(2);
    expect(await call(3)).toEqual({ ok: false, status: 409, error: "Ya empezaste a crear el fondo con 2 votos necesarios: elegí 2 para seguir." });
    expect((await draftById(db, fundId))?.votesRequired).toBe(2);
    expect(await call(2)).toEqual(first); // the same call, as the creator coming back to a closed tab gets
  });
});

describe("cancelDeploy", () => {
  it("opens a draft whose deploy sent nothing, or only failed, to people joining again", async () => {
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    const ana = people[0]!.id;
    const late = await addUser(db, "Dani");

    await deployCall(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT });
    expect(await cancelDeploy(db, { fundId, userId: people[1]!.id })).toMatchObject({ ok: false, status: 403 });
    expect(await cancelDeploy(db, { fundId, userId: ana })).toEqual({ ok: true, reopened: true });
    expect(await draftById(db, fundId)).toMatchObject({ status: "draft", votesRequired: null });

    await deployCall(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT });
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId });
    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: false });
    expect(await cancelDeploy(db, { fundId, userId: ana })).toEqual({ ok: true, reopened: true });
    expect(await joinFund(db, late.id, inviteCode)).toMatchObject({ ok: true, status: "draft" });
  });

  it("keeps the list frozen while a createFund for it is on its way or went through", async () => {
    const db = await testDb();
    const { people, fundId, inviteCode } = await group(db);
    const ana = people[0]!.id;
    const late = await addUser(db, "Dani");
    await deployCall(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT });
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId });

    expect(await cancelDeploy(db, { fundId, userId: ana })).toEqual({ ok: true, reopened: false });
    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: true });
    expect(await cancelDeploy(db, { fundId, userId: ana })).toEqual({ ok: true, reopened: false });
    expect(await draftById(db, fundId)).toMatchObject({ status: "deploying", votesRequired: 2 });
    expect(await joinFund(db, late.id, inviteCode)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("confirmDeploy", () => {
  it("goes live only with the factory's fund for this creator, with the draft's exact settings", async () => {
    const db = await testDb();
    const { people, fundId } = await group(db);
    const other = await group(db); // another group's draft, there before any confirmation: it must stay untouched
    const creator = getAddress(people[0]!.account);
    const members = people.map((p) => getAddress(p.account));
    await deployCall(db, { fundId, userId: people[0]!.id, votesRequired: 2, agent: AGENT });
    const confirm = (client: ReturnType<typeof fakeClient>, userId = people[0]!.id) =>
      confirmDeploy(db, { fundId, userId, transactionHash: TX, client: client as never, agent: AGENT, factory: FUND_FACTORY });

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
});

describe("deployStep", () => {
  async function deploying(db: Db) {
    const { people, fundId } = await group(db, 4); // four, so 2 and 3 votes are both valid
    const ana = people[0]!.id;
    const members = people.map((p) => getAddress(p.account));
    /** The chain's log search for UserOperationEvents: by default, it finds nothing. */
    const findOperation = vi.fn<UserOperationFinder>(async () => null);
    const step = (client: ReturnType<typeof fakeClient>, votesRequired = 2) =>
      deployStep(db, { fundId, userId: ana, votesRequired, agent: AGENT, client: client as never, findOperation, factory: FUND_FACTORY });
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
    expect(await cancelDeploy(db, { fundId, userId: ana })).toEqual({ ok: true, reopened: false });
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
});

describe("agentAddress", () => {
  it("names AGENT_ADDRESS without a key, the key's address on the fork, and stops on mainnet for any other key", () => {
    expect(agentAddress({ CHAIN_MODE: "mainnet", AGENT_PRIVATE_KEY: undefined })).toBe(AGENT_ADDRESS);
    const key = generatePrivateKey();
    expect(agentAddress({ CHAIN_MODE: "fork", AGENT_PRIVATE_KEY: key })).toBe(privateKeyToAddress(key));
    expect(() => agentAddress({ CHAIN_MODE: "mainnet", AGENT_PRIVATE_KEY: key })).toThrow(/AGENT_ADDRESS/);
  });
});
