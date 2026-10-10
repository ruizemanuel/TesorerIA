import { FUND_FACTORY, fundAbi, fundFactoryAbi } from "@tesoreria/agent";
import { type SQL, and, asc, desc, eq, isNull, ne, notExists, or, sql } from "drizzle-orm";
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
import { z } from "zod";
import type { Db } from "./db/client";
import { funds, memberships, operations, users } from "./db/schema";
import { MAX_PESOS, WARS_UNIT, formatPesos } from "./format";
import { memberFundAbi } from "./fund-abi";

/** The spec's default (4): about US$ 300. */
export const DEFAULT_BALANCE_CAP = 450_000n * WARS_UNIT;
export const MIN_MEMBERS = 3;
const MAX_MEMBERS = 10;

export type FundsResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false, status, error }) as const;

const NOT_FOUND = "No encontramos ese fondo.";
const ONLY_CREATOR = "Solo quien armó el fondo puede crearlo.";
const ALREADY_LIVE = "El fondo ya está creado.";
const BEING_CREATED = "El fondo se está creando en este momento. Probá en un rato.";
const UNCONFIRMED = "La operación todavía no se confirmó. Probá en un rato.";

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
  input: { name: string; agreedExpense: string; weeklyFee: bigint; weeklyCap: bigint },
): Promise<FundsResult<{ id: string; inviteCode: string }>> {
  const name = input.name.trim();
  const agreedExpense = input.agreedExpense.trim();
  if (name.length === 0 || name.length > 40) return fail(400, "Poné un nombre para el fondo, de hasta 40 letras.");
  if (agreedExpense.length === 0 || agreedExpense.length > 40) return fail(400, "Poné cuál es el gasto acordado, de hasta 40 letras.");
  if (input.weeklyFee <= 0n) return fail(400, "La cuota tiene que ser más que cero.");
  if (input.weeklyCap <= 0n) return fail(400, "El tope tiene que ser más que cero.");
  if (input.weeklyFee > MAX_PESOS) return fail(400, `La cuota no puede pasar de ${formatPesos(MAX_PESOS)}.`);
  if (input.weeklyCap > MAX_PESOS) return fail(400, `El tope no puede pasar de ${formatPesos(MAX_PESOS)}.`);
  const inviteCode = Base64.fromBytes(Bytes.random(9), { url: true, pad: false });
  const [fund] = await db
    .insert(funds)
    .values({ name, agreedExpense, weeklyFee: input.weeklyFee, weeklyCap: input.weeklyCap, balanceCap: DEFAULT_BALANCE_CAP, creatorId, inviteCode })
    .returning({ id: funds.id });
  await db.insert(memberships).values({ fundId: fund!.id, userId: creatorId });
  return { ok: true, id: fund!.id, inviteCode };
}

/**
 * A fund's people in the order they joined, and by id when two joined at the same instant, so every reader
 * (deployCall, confirmDeploy, the week's list) gets the same order.
 */
async function membersOf(db: Db, fundId: string): Promise<DraftSummary["members"]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, account: users.account })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.fundId, fundId))
    .orderBy(asc(memberships.joinedAt), asc(memberships.userId));
  return rows.map((row) => ({ ...row, account: getAddress(row.account) }));
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

async function isMember(db: Db, fundId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.fundId, fundId), eq(memberships.userId, userId)));
  return row !== undefined;
}

/** Joins a draft by its link. A live fund only takes new members by a vote (part 2), so the link stops there. */
export async function joinFund(
  db: Db,
  userId: string,
  code: string,
): Promise<FundsResult<{ fundId: string; status: "draft" | "live"; address: Address | null }>> {
  const draft = await draftByInvite(db, code);
  if (draft === null) return fail(404, "Ese link de invitación no es válido.");
  const joined = { ok: true, fundId: draft.id, status: "draft", address: null } as const;
  if (draft.members.some((m) => m.userId === userId)) {
    return draft.status === "live" ? { ok: true, fundId: draft.id, status: "live", address: draft.address } : joined;
  }
  if (draft.status === "live") return fail(409, "El fondo ya está en marcha: pedile a alguien del grupo que proponga sumarte.");
  if (draft.status === "deploying") return fail(409, BEING_CREATED);
  if (draft.members.length >= MAX_MEMBERS) return fail(409, "El fondo ya tiene 10 personas, que es el máximo.");
  // Only while it's still a draft, checked in the same statement: a deploy that started after the read above
  // keeps the list it was built with.
  await db
    .insert(memberships)
    .select((qb) =>
      qb
        .select({ fundId: funds.id, userId: sql<string>`${userId}::uuid`.as("user_id"), joinedAt: sql<Date>`now()`.as("joined_at") })
        .from(funds)
        .where(and(eq(funds.id, draft.id), eq(funds.status, "draft"))),
    )
    .onConflictDoNothing();
  return (await isMember(db, draft.id, userId)) ? joined : fail(409, BEING_CREATED);
}

/**
 * The creator's createFund call (spec, 9: the creator deploys it, in a transaction signed by them). It freezes
 * the draft (`deploying`): nobody joins until the deploy goes through or is called off (`cancelDeploy`).
 */
export async function deployCall(
  db: Db,
  { fundId, userId, votesRequired, agent }: { fundId: string; userId: string; votesRequired: number; agent: Address },
): Promise<FundsResult<{ call: { to: Address; data: Hex } }>> {
  const draft = await draftById(db, fundId);
  if (draft === null) return fail(404, NOT_FOUND);
  if (draft.creatorId !== userId) return fail(403, ONLY_CREATOR);
  if (draft.status === "live") return fail(409, ALREADY_LIVE);
  const n = draft.members.length;
  if (n < MIN_MEMBERS) return fail(409, "Hacen falta al menos 3 personas para crear el fondo.");
  if (!Number.isInteger(votesRequired) || votesRequired < 2 || votesRequired > n - 1) {
    return fail(400, `Con ${n} personas, los votos necesarios van de 2 a ${n - 1}.`);
  }
  const [frozen] = await db
    .update(funds)
    .set({ votesRequired, status: "deploying" })
    .where(and(eq(funds.id, fundId), ne(funds.status, "live")))
    .returning({ id: funds.id });
  if (frozen === undefined) return fail(409, ALREADY_LIVE);
  // Read after freezing: whoever got in before it is in the call, and nobody gets in after it.
  const members = await membersOf(db, fundId);
  const data = encodeFunctionData({
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
  return { ok: true, call: { to: FUND_FACTORY, data } };
}

/**
 * Opens a frozen draft to people joining again after a deploy that sent nothing, or whose createFund failed
 * (spec, 9). Never while a createFund for it is on its way or went through: the chain gets that one's list.
 */
export async function cancelDeploy(
  db: Db,
  { fundId, userId }: { fundId: string; userId: string },
): Promise<FundsResult<{ reopened: boolean }>> {
  const draft = await draftById(db, fundId);
  if (draft === null) return fail(404, NOT_FOUND);
  if (draft.creatorId !== userId) return fail(403, ONLY_CREATOR);
  const onItsWayOrThrough = db
    .select({ userOpHash: operations.userOpHash })
    .from(operations)
    .where(
      and(
        eq(operations.draftId, fundId),
        eq(operations.kind, "create-fund"),
        or(isNull(operations.success), eq(operations.success, true)),
      ),
    );
  const reopened = await db
    .update(funds)
    .set({ status: "draft", votesRequired: null })
    .where(and(eq(funds.id, fundId), eq(funds.status, "deploying"), notExists(onItsWayOrThrough)))
    .returning({ id: funds.id });
  return { ok: true, reopened: reopened.length > 0 };
}

type ChainReader = Pick<PublicClient, "getTransactionReceipt" | "multicall">;
type Deployed = { address: Address; block: bigint };

/**
 * The fund the factory created in `transactionHash` for this draft: the FundCreated whose creator is the
 * creator's account, and only if that fund has exactly the draft's settings. Anyone can create funds in the
 * factory, so nothing else is taken for ours. "unconfirmed" while the transaction can't be read.
 */
async function findDeployed(
  draft: DraftSummary,
  votesRequired: number,
  { transactionHash, client, agent, factory }: { transactionHash: Hash; client: ChainReader; agent: Address; factory: Address },
): Promise<Deployed | null | "unconfirmed"> {
  const creator = draft.members.find((m) => m.userId === draft.creatorId)?.account;
  if (creator === undefined) return null;
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
    return null;
  } catch {
    return "unconfirmed"; // not mined yet, or the node didn't answer: try again later, never as "not ours"
  }
}

async function markLive(db: Db, fundId: string, { address, block }: Deployed): Promise<FundsResult<{ address: Address }>> {
  await db.update(funds).set({ status: "live", address, createdBlock: block }).where(eq(funds.id, fundId));
  return { ok: true, address };
}

/** Marks the draft live with the fund the factory created in `transactionHash` (see `findDeployed`). */
export async function confirmDeploy(
  db: Db,
  {
    fundId,
    userId,
    transactionHash,
    client,
    agent,
    factory = FUND_FACTORY,
  }: { fundId: string; userId: string; transactionHash: Hash; client: ChainReader; agent: Address; factory?: Address },
): Promise<FundsResult<{ address: Address }>> {
  const draft = await draftById(db, fundId);
  if (draft === null) return fail(404, NOT_FOUND);
  if (draft.creatorId !== userId) return fail(403, ONLY_CREATOR);
  if (draft.status === "live" && draft.address !== null) return { ok: true, address: draft.address };
  if (draft.status !== "deploying" || draft.votesRequired === null) return fail(409, "Primero hay que crear el fondo.");
  const found = await findDeployed(draft, draft.votesRequired, { transactionHash, client, agent, factory });
  if (found === "unconfirmed") return fail(409, UNCONFIRMED);
  if (found === null) return fail(409, "No encontramos el fondo en esa operación.");
  return markLive(db, fundId, found);
}

export type DeployStep = { address: Address } | { pending: Hash } | { call: { to: Address; data: Hex } };

/**
 * What the creator's "Crear el fondo" does next. A createFund is never sent twice (spec, 6): with one already
 * sent for this draft, a new one is built only once that one is known to have created no fund of ours.
 * - `address`: it's live, or the sent one's transaction has our fund;
 * - `pending`: the sent one has no receipt here yet, so the browser asks the bundler for it first;
 * - `call`: nothing was sent, or what was sent failed. `votesRequired` only counts here: a sent one keeps its own.
 */
export async function deployStep(
  db: Db,
  {
    fundId,
    userId,
    votesRequired,
    agent,
    client,
    factory = FUND_FACTORY,
  }: { fundId: string; userId: string; votesRequired: number; agent: Address; client: ChainReader; factory?: Address },
): Promise<FundsResult<DeployStep>> {
  const draft = await draftById(db, fundId);
  if (draft === null) return fail(404, NOT_FOUND);
  if (draft.creatorId !== userId) return fail(403, ONLY_CREATOR);
  if (draft.status === "live" && draft.address !== null) return { ok: true, address: draft.address };
  const [sent] = await db
    .select({ userOpHash: operations.userOpHash, transactionHash: operations.transactionHash })
    .from(operations)
    .where(and(eq(operations.draftId, fundId), eq(operations.userId, userId), eq(operations.kind, "create-fund")))
    .orderBy(desc(operations.createdAt))
    .limit(1);
  if (sent !== undefined) {
    if (sent.transactionHash === null) return { ok: true, pending: sent.userOpHash as Hash };
    if (draft.status === "deploying" && draft.votesRequired !== null) {
      const transactionHash = sent.transactionHash as Hash;
      const found = await findDeployed(draft, draft.votesRequired, { transactionHash, client, agent, factory });
      if (found === "unconfirmed") return fail(409, UNCONFIRMED);
      if (found !== null) return markLive(db, fundId, found);
    }
    // It created no fund of ours (or it failed and the draft was opened again): another one can go.
  }
  return deployCall(db, { fundId, userId, votesRequired, agent });
}

/** The funds a person belongs to, live ones first. */
export async function fundsOf(db: Db, userId: string) {
  const rows = await db
    .select({ id: funds.id, status: funds.status, address: funds.address })
    .from(memberships)
    .innerJoin(funds, eq(funds.id, memberships.fundId))
    .where(eq(memberships.userId, userId));
  return rows.sort((a, b) => Number(b.status === "live") - Number(a.status === "live"));
}
