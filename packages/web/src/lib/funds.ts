import { FUND_FACTORY, fundAbi, fundFactoryAbi } from "@tesoreria/agent";
import { type SQL, and, asc, desc, eq, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Base64, Bytes } from "ox";
import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  parseEventLogs,
} from "viem";
import { entryPoint07Abi, entryPoint07Address } from "viem/account-abstraction";
import { z } from "zod";
import type { UserOperationFinder } from "./chain";
import { type DraftSettings, draftProblem } from "./checks";
import { MAX_CREATE_FUND_NONCES, createFundRoom } from "./create-fund-cap";
import { type Db, inTransaction } from "./db/client";
import { funds, memberships, operations, users } from "./db/schema";
import { DEFAULT_BALANCE_CAP, MAX_MEMBERS, memberFundAbi } from "./fund-abi";
import { fail, isMember, lockFund } from "./fund-rows";
import type { Messages } from "./i18n/messages";
import { requestToJoin } from "./join-requests";
import { PENDING_FOR_MS, finishOperation } from "./operations";

export const MIN_MEMBERS = 3;
export { MAX_MEMBERS };

export type FundsResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export type DraftSummary = {
  id: string;
  name: string;
  agreedExpense: string;
  weeklyFee: bigint;
  weeklyCap: bigint;
  votesRequired: number | null;
  status: "draft" | "deploying" | "live";
  address: Address | null;
  inviteCode: string;
  creatorId: string;
  creatorName: string;
  /** In the order they joined: the order createFund gets, and the week's list keeps. */
  members: { userId: string; name: string; account: Address }[];
};

export async function createDraft(
  db: Db,
  creatorId: string,
  input: DraftSettings,
  m: Messages,
): Promise<FundsResult<{ id: string; inviteCode: string }>> {
  const problem = draftProblem(input, m);
  if (problem !== null) return fail(400, problem);
  const name = input.name.trim();
  const agreedExpense = input.agreedExpense.trim();
  const inviteCode = Base64.fromBytes(Bytes.random(9), { url: true, pad: false });
  const [fund] = await db
    .insert(funds)
    .values({ name, agreedExpense, weeklyFee: input.weeklyFee, weeklyCap: input.weeklyCap, balanceCap: DEFAULT_BALANCE_CAP, creatorId, inviteCode })
    .returning({ id: funds.id });
  await db.insert(memberships).values({ fundId: fund!.id, userId: creatorId });
  return { ok: true, id: fund!.id, inviteCode };
}

/**
 * The order of a fund's people: as they joined, and by id when two joined at the same instant, so every reader
 * (deployCall, confirmDeploy, the week's list, and the bundler gateway through `frozenCreateFunds`) gets the same.
 */
const MEMBER_ORDER = [asc(memberships.joinedAt), asc(memberships.userId)];
const memberFields = { userId: users.id, name: users.name, account: users.account };

/** A fund's people, in MEMBER_ORDER. */
function membersQuery(db: Db, fundId: string) {
  return db
    .select(memberFields)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.fundId, fundId))
    .orderBy(...MEMBER_ORDER);
}

function asMembers(rows: Awaited<ReturnType<typeof membersQuery>>): DraftSummary["members"] {
  return rows.map((row) => ({ ...row, account: getAddress(row.account) }));
}

async function membersOf(db: Db, fundId: string): Promise<DraftSummary["members"]> {
  return asMembers(await membersQuery(db, fundId));
}

async function summarize(db: Db, where: SQL): Promise<DraftSummary | null> {
  const [fund] = await db.select().from(funds).where(where);
  if (fund === undefined) return null;
  const members = await membersOf(db, fund.id);
  const creator = members.find((member) => member.userId === fund.creatorId);
  return {
    id: fund.id,
    name: fund.name,
    agreedExpense: fund.agreedExpense,
    weeklyFee: fund.weeklyFee,
    weeklyCap: fund.weeklyCap,
    votesRequired: fund.votesRequired,
    status: fund.status,
    address: fund.address === null ? null : getAddress(fund.address),
    inviteCode: fund.inviteCode,
    creatorId: fund.creatorId,
    creatorName: creator?.name ?? "",
    members,
  };
}

const uuid = z.uuid();

/** The draft with this id, or null; an id from the address bar that isn't a uuid is just not found. */
export async function draftById(db: Db, id: string): Promise<DraftSummary | null> {
  return uuid.safeParse(id).success ? summarize(db, eq(funds.id, id)) : null;
}

export function draftByInvite(db: Db, code: string): Promise<DraftSummary | null> {
  return summarize(db, eq(funds.inviteCode, code));
}

/**
 * Joins a draft by its link. A live fund takes new members only by a vote (spec, 9.4), so there the link asks to join
 * (requestToJoin) and the group proposes them; a member is just taken to it.
 */
export async function joinFund(
  db: Db,
  userId: string,
  code: string,
  m: Messages,
): Promise<FundsResult<{ fundId: string; status: "draft" | "live" | "requested"; address: Address | null }>> {
  const draft = await draftByInvite(db, code);
  if (draft === null) return fail(404, m.funds.badInvite);
  const joined = { ok: true, fundId: draft.id, status: "draft", address: null } as const;
  if (draft.members.some((member) => member.userId === userId)) {
    return draft.status === "live" ? { ok: true, fundId: draft.id, status: "live", address: draft.address } : joined;
  }
  if (draft.status === "live") {
    const requested = await requestToJoin(db, draft.id, userId, m);
    return requested.ok ? { ok: true, fundId: draft.id, status: "requested", address: draft.address } : requested;
  }
  if (draft.status === "deploying") return fail(409, m.funds.beingCreated);
  if (draft.members.length >= MAX_MEMBERS) return fail(409, m.funds.full);
  // Checked again in the insert, since the read above may be stale: only while it's still a draft (a deploy that
  // started since keeps the list it was built with), and only while there's room (two people joining at nine would
  // make eleven, which createFund always refuses). The fund's row is locked first, so a freeze or another join that
  // got there before has committed by the time the insert reads.
  await inTransaction(db, (tx) => {
    const joining = tx.$count(memberships, eq(memberships.fundId, draft.id));
    return [
      lockFund(tx, draft.id),
      tx
        .insert(memberships)
        .select((qb) =>
          qb
            .select({ fundId: funds.id, userId: sql<string>`${userId}::uuid`.as("user_id"), joinedAt: sql<Date>`now()`.as("joined_at") })
            .from(funds)
            .where(and(eq(funds.id, draft.id), eq(funds.status, "draft"), sql`${joining} < ${MAX_MEMBERS}`)),
        )
        .onConflictDoNothing(),
    ];
  });
  if (await isMember(db, draft.id, userId)) return joined;
  const [now] = await db.select({ status: funds.status }).from(funds).where(eq(funds.id, draft.id));
  return fail(409, now?.status === "draft" ? m.funds.full : m.funds.beingCreated);
}

/**
 * The creator's createFund call (spec, 9: the creator deploys it, in a transaction signed by them). It freezes
 * the draft (`deploying`) with these votes: nobody joins and the votes don't change until the deploy goes
 * through or is called off (`cancelDeploy`).
 */
export async function deployCall(
  db: Db,
  { fundId, userId, votesRequired, agent, m }: { fundId: string; userId: string; votesRequired: number; agent: Address; m: Messages },
): Promise<FundsResult<{ call: { to: Address; data: Hex } }>> {
  const draft = await draftById(db, fundId);
  if (draft === null) return fail(404, m.errors.fundNotFound);
  if (draft.creatorId !== userId) return fail(403, m.funds.onlyCreator);
  if (draft.status === "live") return fail(409, m.funds.alreadyCreated);
  const n = draft.members.length;
  if (n < MIN_MEMBERS) return fail(409, m.funds.tooFewMembers);
  if (n > MAX_MEMBERS) return fail(409, m.funds.tooManyMembers(MAX_MEMBERS, n));
  if (!Number.isInteger(votesRequired) || votesRequired < 2 || votesRequired > n - 1) {
    return fail(400, m.funds.votesRange(n));
  }
  // Once it's being created, the votes are the ones being signed: another tab can't change them underneath.
  if (draft.status === "deploying" && draft.votesRequired !== votesRequired) {
    return fail(409, m.funds.votesLocked(draft.votesRequired!));
  }
  // Frozen and read under the fund's lock (see `lockFund`): whoever got in before is in the call, and nobody gets
  // in after.
  const [, [frozen], rows] = await inTransaction(db, (tx) => [
    lockFund(tx, fundId),
    tx
      .update(funds)
      .set({ votesRequired, status: "deploying" })
      .where(
        and(
          eq(funds.id, fundId),
          or(eq(funds.status, "draft"), and(eq(funds.status, "deploying"), eq(funds.votesRequired, votesRequired))),
        ),
      )
      .returning({ id: funds.id }),
    membersQuery(tx, fundId),
  ]);
  if (frozen === undefined) return fail(409, m.funds.beingCreated); // it changed since the read above
  const data = createFundData(draft, asMembers(rows), votesRequired, agent);
  return { ok: true, call: { to: FUND_FACTORY, data } };
}

/**
 * FundFactory.createFund's calldata for a draft, with `members` in `membersQuery`'s order (joined at, then user
 * id). The only encoding of it: deployCall hands it to the creator to sign, and the bundler gateway sponsors no
 * other createFund (`frozenCreateFunds`), so the two can't drift.
 */
function createFundData(
  draft: Pick<DraftSummary, "name" | "agreedExpense" | "weeklyCap">,
  members: DraftSummary["members"],
  votesRequired: number,
  agent: Address,
): Hex {
  return encodeFunctionData({
    abi: fundFactoryAbi,
    functionName: "createFund",
    args: [
      {
        name: draft.name,
        members: members.map((m) => m.account),
        votesRequired,
        agent,
        agreedExpense: draft.agreedExpense,
        weeklyCap: draft.weeklyCap,
        balanceCap: DEFAULT_BALANCE_CAP,
      },
    ],
  });
}

/**
 * The createFund calldata of each draft `creatorId` made that is being created (`deploying`), naming `agent()`:
 * exactly what deployCall built when it froze it, since nobody joins and the votes don't change until it's live
 * or open again, and with its members in the same order (MEMBER_ORDER). The only createFunds the bundler gateway
 * sponsors (spec, 6). `agent` is called only if there's one: it throws on a misconfigured server (`agentAddress`),
 * which mustn't stop everyone else's requests.
 */
export async function frozenCreateFunds(db: Db, creatorId: string, agent: () => Address): Promise<Hex[]> {
  // Each draft once per member, in one statement: by draft, then in MEMBER_ORDER, which the grouping below keeps.
  const rows = await db
    .select({
      draft: { id: funds.id, name: funds.name, agreedExpense: funds.agreedExpense, weeklyCap: funds.weeklyCap, votesRequired: funds.votesRequired },
      member: memberFields,
    })
    .from(funds)
    .innerJoin(memberships, eq(memberships.fundId, funds.id))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(funds.creatorId, creatorId), eq(funds.status, "deploying"), isNotNull(funds.votesRequired)))
    .orderBy(asc(funds.id), ...MEMBER_ORDER);
  if (rows.length === 0) return [];
  type Row = (typeof rows)[number];
  const frozen = new Map<string, { draft: Row["draft"]; members: Row["member"][] }>();
  for (const { draft, member } of rows) {
    const entry = frozen.get(draft.id) ?? { draft, members: [] };
    entry.members.push(member);
    frozen.set(draft.id, entry);
  }
  const named = agent();
  return [...frozen.values()].map(({ draft, members }) => createFundData(draft, asMembers(members), draft.votesRequired!, named));
}

/**
 * Opens a frozen draft to people joining again after a deploy that sent nothing, or whose createFund failed
 * (spec, 9). Never while a createFund for it is on its way or went through: the chain gets that one's list.
 */
export async function cancelDeploy(
  db: Db,
  { fundId, userId, m }: { fundId: string; userId: string; m: Messages },
): Promise<FundsResult<{ reopened: boolean }>> {
  const draft = await draftById(db, fundId);
  if (draft === null) return fail(404, m.errors.fundNotFound);
  if (draft.creatorId !== userId) return fail(403, m.funds.onlyCreator);
  return { ok: true, reopened: await reopen(db, fundId) };
}

/** `deploying` back to `draft`, in one statement, unless a createFund for it is on its way or went through. */
async function reopen(db: Db, fundId: string): Promise<boolean> {
  // One without a receipt is spent once another with its nonce went through (a resend pinned to it, see
  // deployStep): the chain took that nonce, so it can never land.
  const resend = alias(operations, "resend");
  const spent = db
    .select({ userOpHash: resend.userOpHash })
    .from(resend)
    .where(and(eq(resend.draftId, operations.draftId), eq(resend.nonce, operations.nonce), isNotNull(resend.transactionHash)));
  const onItsWayOrThrough = db
    .select({ userOpHash: operations.userOpHash })
    .from(operations)
    .where(
      and(
        eq(operations.draftId, fundId),
        eq(operations.kind, "create-fund"),
        or(eq(operations.success, true), and(isNull(operations.success), notExists(spent))),
      ),
    );
  const reopened = await db
    .update(funds)
    .set({ status: "draft", votesRequired: null })
    .where(and(eq(funds.id, fundId), eq(funds.status, "deploying"), notExists(onItsWayOrThrough)))
    .returning({ id: funds.id });
  return reopened.length > 0;
}

type ChainReader = Pick<PublicClient, "getTransactionReceipt" | "multicall" | "readContract">;
type Deployed = { address: Address; block: bigint };

/**
 * The fund the factory created in `transactionHash` for this draft: the FundCreated whose creator is the
 * creator's account, and only if that fund has exactly the draft's settings. Anyone can create funds in the
 * factory, so nothing else is taken for ours. Otherwise, why not:
 * - "none": the factory created nothing for the creator there, so that operation failed;
 * - "mismatch": it created one for the creator, but with other settings. A real fund all the same, so it must
 *   never be taken for a failure (another createFund would make a second one);
 * - "unconfirmed": the transaction can't be read yet.
 */
async function findDeployed(
  draft: DraftSummary,
  votesRequired: number | null,
  { transactionHash, client, agent, factory }: { transactionHash: Hash; client: ChainReader; agent: Address; factory: Address },
): Promise<Deployed | "none" | "mismatch" | "unconfirmed"> {
  const creator = draft.members.find((m) => m.userId === draft.creatorId)?.account;
  if (creator === undefined) return "mismatch"; // can't tell whose it is: never take it for a failure
  try {
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    const created = parseEventLogs({ abi: fundFactoryAbi, eventName: "FundCreated", logs: receipt.logs }).filter(
      (log) => isAddressEqual(log.address, factory) && isAddressEqual(log.args.creator, creator),
    );
    for (const log of created) {
      const fund = log.args.fund;
      const [members, votes, fundAgent, weeklyCap, balanceCap, name, agreedExpense] = await client.multicall({
        allowFailure: false,
        contracts: [
          { address: fund, abi: fundAbi, functionName: "members" },
          { address: fund, abi: fundAbi, functionName: "votesRequired" },
          { address: fund, abi: fundAbi, functionName: "agent" },
          { address: fund, abi: fundAbi, functionName: "weeklyCap" },
          { address: fund, abi: memberFundAbi, functionName: "balanceCap" },
          { address: fund, abi: memberFundAbi, functionName: "name" },
          { address: fund, abi: memberFundAbi, functionName: "agreedExpense" },
        ],
      });
      const sameMembers =
        members.length === draft.members.length && members.every((m, i) => isAddressEqual(m, draft.members[i]!.account));
      if (
        sameMembers &&
        votes === votesRequired &&
        isAddressEqual(fundAgent, agent) &&
        weeklyCap === draft.weeklyCap &&
        balanceCap === DEFAULT_BALANCE_CAP &&
        name === draft.name &&
        agreedExpense === draft.agreedExpense
      ) {
        return { address: getAddress(fund), block: receipt.blockNumber };
      }
    }
    return created.length === 0 ? "none" : "mismatch";
  } catch {
    return "unconfirmed"; // not mined yet, or the node didn't answer: try again later, never as "not ours"
  }
}

async function markLive(db: Db, fundId: string, { address, block }: Deployed): Promise<FundsResult<{ address: Address }>> {
  await db.update(funds).set({ status: "live", address, createdBlock: block }).where(eq(funds.id, fundId));
  return { ok: true, address };
}

/**
 * How long confirmDeploy keeps reading a createFund the browser just saw land, about 17 s: the bundler reports the
 * receipt as soon as its own node has it, and our node (forno) can be a few seconds behind. The real group's
 * createFund got "todavía no se confirmó" that way on 11/10, though it had gone through.
 */
const CONFIRM_WAIT = { tries: 8, everyMs: 2_500 };

/**
 * Marks the draft live with the fund the factory created in `transactionHash` (see `findDeployed`). The browser
 * calls it right after the receipt, so a transaction it can't read yet is read again for a while (`wait`) before
 * it answers "unconfirmed".
 */
export async function confirmDeploy(
  db: Db,
  {
    fundId,
    userId,
    transactionHash,
    client,
    agent,
    factory = FUND_FACTORY,
    wait = CONFIRM_WAIT,
    m,
  }: {
    fundId: string;
    userId: string;
    transactionHash: Hash;
    client: ChainReader;
    agent: Address;
    factory?: Address;
    wait?: { tries: number; everyMs: number };
    m: Messages;
  },
): Promise<FundsResult<{ address: Address }>> {
  const draft = await draftById(db, fundId);
  if (draft === null) return fail(404, m.errors.fundNotFound);
  if (draft.creatorId !== userId) return fail(403, m.funds.onlyCreator);
  if (draft.status === "live" && draft.address !== null) return { ok: true, address: draft.address };
  if (draft.status !== "deploying" || draft.votesRequired === null) return fail(409, m.funds.createFirst);
  const read = () => findDeployed(draft, draft.votesRequired, { transactionHash, client, agent, factory });
  let found = await read();
  for (let tried = 1; found === "unconfirmed" && tried < wait.tries; tried++) {
    await new Promise((resolve) => setTimeout(resolve, wait.everyMs));
    found = await read();
  }
  if (found === "unconfirmed") return fail(409, m.funds.unconfirmed);
  if (found === "mismatch") return fail(409, m.funds.mismatch);
  if (found === "none") return fail(409, m.funds.notInOperation);
  return markLive(db, fundId, found);
}

export type DeployStep = { address: Address } | { pending: Hash } | { call: { to: Address; data: Hex }; nonce?: bigint };

/**
 * Where a createFund that never came back stands, by the chain's nonce read now (never a flag from before):
 * - "recent": sent less than PENDING_FOR_MS ago, so the bundler still knows it: the browser asks it first;
 * - "unspent": the chain still has the nonce it was sent with, so it hasn't landed (and has no receipt), and a resend
 *   pinned to that nonce can't land as well as it: it may be released;
 * - "spent": it, or something else with its nonce, landed: never released, only found (`findLanded`);
 * - "unknown": the node didn't answer: as if it were still on its way.
 * The bundler's word isn't enough to release one: it only looks at recent blocks, never at what it once had.
 */
async function nonceState(client: ChainReader, account: Address, nonce: bigint, sentAt: Date): Promise<"recent" | "unspent" | "spent" | "unknown"> {
  if (Date.now() - sentAt.getTime() < PENDING_FOR_MS) return "recent";
  try {
    return (await keyZeroNonce(client, account)) === nonce ? "unspent" : "spent";
  } catch {
    return "unknown";
  }
}

/** The account's EntryPoint nonce now, with key 0: the one a createFund from it goes on (client/wallet.ts). */
function keyZeroNonce(client: ChainReader, account: Address): Promise<bigint> {
  return client.readContract({ address: entryPoint07Address, abi: entryPoint07Abi, functionName: "getNonce", args: [account, 0n] });
}

/**
 * The paymaster's caps, asked before a new createFund is built and its draft frozen (M5): a creator who reached one
 * reads why, instead of the paymaster's refusal after the freeze, which only shows as a generic failure. It asks about
 * the nonce the browser will send it on, the chain's now: one the paymaster already signed for them is signed again.
 * Null when there's room, or when the nonce can't be read: the paymaster still holds the caps.
 */
async function createFundCapped(
  db: Db,
  { userId, account, client, dailyLimit, m }: { userId: string; account: Address | undefined; client: ChainReader; dailyLimit: number; m: Messages },
): Promise<ReturnType<typeof fail> | null> {
  if (account === undefined) return null;
  let nonce: bigint;
  try {
    nonce = await keyZeroNonce(client, account);
  } catch {
    return null;
  }
  const room = await createFundRoom(db, userId, nonce, dailyLimit);
  return room === "ok" ? null : fail(429, room === "account" ? m.funds.accountCap(MAX_CREATE_FUND_NONCES) : m.funds.dayCap);
}

/**
 * The transaction of a createFund for this draft that landed with `nonce` though nobody recorded its receipt (the
 * creator left during the wait), found on the chain itself: by then the bundler, which only looks about 2,000
 * blocks back, would answer "not found" forever. Every operation pinned to that nonce is looked for, since the
 * one that never came back may land instead of its resend. The one found is recorded; null if none is there yet,
 * or the chain can't be read.
 */
async function findLanded(
  db: Db,
  { fundId, userId, nonce, findOperation }: { fundId: string; userId: string; nonce: bigint; findOperation: UserOperationFinder },
): Promise<Hash | null> {
  const pinned = await db
    .select({ userOpHash: operations.userOpHash, createdAt: operations.createdAt })
    .from(operations)
    .where(and(eq(operations.draftId, fundId), eq(operations.userId, userId), eq(operations.kind, "create-fund"), eq(operations.nonce, nonce)));
  const since = new Date(Math.min(...pinned.map((row) => row.createdAt.getTime())));
  let landed: Awaited<ReturnType<UserOperationFinder>>;
  try {
    landed = await findOperation({ userOpHashes: pinned.map((row) => row.userOpHash as Hash), since });
  } catch {
    return null;
  }
  if (landed === null) return null;
  await finishOperation(db, userId, landed);
  return landed.transactionHash;
}

/**
 * What the creator's "Crear fondo" does next. A createFund is never sent twice (spec, 6): with one already
 * sent for this draft, a new one is built only once that one is known to have created nothing.
 * - `address`: it's live, or the sent one's transaction has our fund;
 * - `pending`: the sent one has no receipt here yet, so the browser asks the bundler for it first;
 * - `call` with `nonce`: the sent one never came back and the chain shows it never landed (`nonceState`): the
 *   same call again, pinned to its nonce;
 * - `call`: nothing was sent, or what was sent failed (its nonce is spent), and the draft opened again first.
 *   `votesRequired` only counts here: a sent one keeps its own;
 * - 409: the sent one created a fund for the creator with other settings (a real fund, so never another), or the
 *   draft can't open again because another createFund for it is on its way;
 * - 429: a new one wouldn't be sponsored, the creator's or the day's cap is reached (`createFundCapped`, M5). The
 *   draft is left open.
 * A sent one whose receipt never came back but whose nonce the chain spent is looked for on the chain
 * (`findOperation`), and then goes on as if its receipt had come.
 */
export async function deployStep(
  db: Db,
  {
    fundId,
    userId,
    votesRequired,
    agent,
    client,
    findOperation,
    createFundDailyLimit,
    factory = FUND_FACTORY,
    m,
  }: {
    fundId: string;
    userId: string;
    votesRequired: number;
    agent: Address;
    client: ChainReader;
    findOperation: UserOperationFinder;
    /** CREATE_FUND_DAILY_LIMIT: the day's cap the paymaster holds, asked before a new one is built. */
    createFundDailyLimit: number;
    factory?: Address;
    m: Messages;
  },
): Promise<FundsResult<DeployStep>> {
  const draft = await draftById(db, fundId);
  if (draft === null) return fail(404, m.errors.fundNotFound);
  if (draft.creatorId !== userId) return fail(403, m.funds.onlyCreator);
  if (draft.status === "live" && draft.address !== null) return { ok: true, address: draft.address };
  const creator = draft.members.find((member) => member.userId === draft.creatorId)?.account;
  const [sent] = await db
    .select({
      userOpHash: operations.userOpHash,
      transactionHash: operations.transactionHash,
      nonce: operations.nonce,
      createdAt: operations.createdAt,
    })
    .from(operations)
    .where(and(eq(operations.draftId, fundId), eq(operations.userId, userId), eq(operations.kind, "create-fund")))
    .orderBy(desc(operations.createdAt))
    .limit(1);
  if (sent !== undefined) {
    let transactionHash = sent.transactionHash as Hash | null;
    if (transactionHash === null) {
      const { nonce } = sent;
      const state = nonce === null || creator === undefined ? "unknown" : await nonceState(client, creator, nonce, sent.createdAt);
      if (state === "unspent") {
        // The same call again, with the votes it was frozen with, pinned to its nonce: whichever of the two lands
        // is the same fund, and the other can't land at all.
        const again = await deployCall(db, { fundId, userId, votesRequired: draft.votesRequired ?? votesRequired, agent, m });
        return again.ok ? { ...again, nonce: nonce! } : again;
      }
      if (state === "spent") transactionHash = await findLanded(db, { fundId, userId, nonce: nonce!, findOperation });
      if (transactionHash === null) return { ok: true, pending: sent.userOpHash as Hash };
    }
    const found = await findDeployed(draft, draft.votesRequired, { transactionHash, client, agent, factory });
    if (found === "unconfirmed") return fail(409, m.funds.unconfirmed);
    if (found === "mismatch") return fail(409, m.funds.mismatch);
    if (found !== "none") return markLive(db, fundId, found);
    // It failed, and its nonce is spent: open the draft again, so the new call takes the votes chosen now. If it
    // can't open (another createFund for it is on its way or went through), nothing new is built.
    if (!(await reopen(db, fundId)) && draft.status === "deploying") return fail(409, m.funds.beingCreated);
  }
  const capped = await createFundCapped(db, { userId, account: creator, client, dailyLimit: createFundDailyLimit, m });
  if (capped !== null) {
    await reopen(db, fundId); // frozen by an earlier click that sent nothing: people can join again meanwhile
    return capped;
  }
  return deployCall(db, { fundId, userId, votesRequired, agent, m });
}

/** The funds a person belongs to, with their names, live ones first. */
export async function fundsOf(db: Db, userId: string) {
  const rows = await db
    .select({ id: funds.id, status: funds.status, address: funds.address, name: funds.name })
    .from(memberships)
    .innerJoin(funds, eq(funds.id, memberships.fundId))
    .where(eq(memberships.userId, userId));
  return rows.sort((a, b) => Number(b.status === "live") - Number(a.status === "live"));
}
