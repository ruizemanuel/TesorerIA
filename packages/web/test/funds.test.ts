import { AGENT_ADDRESS, FUND_FACTORY, fundFactoryAbi } from "@tesoreria/agent";
import { type Address, type Hash, decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, pad } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { agentAddress } from "../src/lib/agent-address";
import type { Db } from "../src/lib/db/client";
import { funds, memberships } from "../src/lib/db/schema";
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
import { finishOperation, recordOperation } from "../src/lib/operations";
import { addLiveFund, addUser, testDb } from "./support/db";
import { AGENT, FUND as NEW_FUND, WARS } from "./support/fixtures";

const TX: Hash = pad("0x7a", { size: 32 });
const OP: Hash = pad("0x0b", { size: 32 });
const DRAFT = { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: 10_000n * WARS, weeklyCap: 60_000n * WARS };

async function group(db: Db, size = 3) {
  const people = [];
  for (const name of ["Ana", "Beto", "Caro", "Dani"].slice(0, size)) people.push(await addUser(db, name));
  const created = await createDraft(db, people[0]!.id, DRAFT);
  if (!created.ok) throw new Error(created.error);
  for (const person of people.slice(1)) await joinFund(db, person.id, created.inviteCode);
  return { people, fundId: created.id, inviteCode: created.inviteCode };
}

/** A receipt with these FundCreated logs, and a chain where every fund has `settings`. */
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
    const { people, fundId } = await group(db);
    const ana = people[0]!.id;
    const members = people.map((p) => getAddress(p.account));
    const step = (client: ReturnType<typeof fakeClient>) =>
      deployStep(db, { fundId, userId: ana, votesRequired: 2, agent: AGENT, client: client as never, factory: FUND_FACTORY });
    return { ana, fundId, members, creator: members[0]!, step };
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

  it("builds a new one when the sent one created no fund of ours", async () => {
    const db = await testDb();
    const { ana, fundId, step } = await deploying(db);
    await step(fakeClient([], []));
    await recordOperation(db, ana, { userOpHash: OP, kind: "create-fund", draftId: fundId });
    await finishOperation(db, ana, { userOpHash: OP, transactionHash: TX, success: false });
    expect(await step(fakeClient([], []))).toMatchObject({ ok: true, call: { to: FUND_FACTORY } });
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
