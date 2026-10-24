import { type PasskeyAssertion, type SafeKey, isSafeKey } from "@tesoreria/wallet";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { type Address, type Hex, isAddressEqual } from "viem";
import { type AuthResult, type NewPasskey, attestedKey, isUniqueViolation, isValidAnswer, takeChallenge } from "./auth";
import { type Db, inTransaction } from "./db/client";
import { credentials, operations } from "./db/schema";
import type { Messages } from "./i18n/messages";
import { LEGACY_RP_ID } from "./passkey-sites";
import type { Session } from "./session";

/**
 * Where a member is in swapping their passkey of the old site for one of tesoreria.finance (spec, 9.5).
 * - `due`: the app asks them to.
 * - `pending`: the new passkey, from the moment it's made until the chain confirms the swap.
 * - `ready`: this session made the pending passkey or proved it holds it, so the swap to its key is sponsored.
 */
export type KeyChangeState = { due: boolean; pending: { id: string; rpId: string; publicKey: Hex } | null; ready: boolean };

/** The new passkey, as the page posts it. Unlike a registration's, never without its attestation: no older page starts a key change. */
export type KeyChangeInput = Required<NewPasskey>;

/** A person's active and pending passkeys: at most one of each. */
async function passkeysOf(db: Db, userId: string) {
  const rows = await db
    .select({ id: credentials.id, publicKey: credentials.publicKey, rpId: credentials.rpId, state: credentials.state })
    .from(credentials)
    .where(and(eq(credentials.userId, userId), inArray(credentials.state, ["active", "pending"])));
  const inState = (state: "active" | "pending") => {
    const row = rows.find((candidate) => candidate.state === state);
    return row === undefined ? undefined : { id: row.id, rpId: row.rpId, publicKey: row.publicKey as Hex };
  };
  return { active: inState("active"), pending: inState("pending") };
}

/**
 * `due` once the site's passkeys are of another site than the person's active one, the old site's, and, while
 * KEY_CHANGE_PILOT (`pilot`) is set, only for that account: anyone else goes on with their old passkey (spec, 9.5).
 */
export async function keyChangeOf(
  db: Db,
  user: { id: string; account: Address },
  session: Pick<Session, "keyChange">,
  { rpId, pilot }: { rpId: string; pilot?: Address },
): Promise<KeyChangeState> {
  const { active, pending } = await passkeysOf(db, user.id);
  return {
    due: active?.rpId === LEGACY_RP_ID && rpId !== LEGACY_RP_ID && (pilot === undefined || isAddressEqual(pilot, user.account)),
    pending: pending ?? null,
    ready: pending !== undefined && session.keyChange === pending.id,
  };
}

/**
 * Keeps the new passkey a person just made as their pending one, and marks this session ready (spec, 9.5). It takes
 * one whose active passkey is the old site's, and checks the new one as a registration does (`attestedKey`): for
 * `rpId`, on this session's challenge. A pending one from before is replaced, unless a key change may still land:
 * the Safe would then hold the key of a passkey the server forgot.
 */
export async function startKeyChange({
  db,
  session,
  user,
  input,
  rpId,
  origin,
  now = Date.now(),
  m,
}: {
  db: Db;
  session: Session;
  user: { id: string };
  input: KeyChangeInput;
  rpId: string;
  origin: string;
  now?: number;
  m: Messages;
}): Promise<{ ok: true; publicKey: Hex } | { ok: false; status: number; error: string }> {
  const challenge = takeChallenge(session, now);
  const fail = async (status: number, error: string) => {
    await session.save();
    return { ok: false, status, error } as const;
  };
  if (challenge === null) return fail(400, m.auth.late);
  const { active, pending } = await passkeysOf(db, user.id);
  if (active?.rpId !== LEGACY_RP_ID) return fail(409, m.errors.generic);
  const publicKey = attestedKey(input, { challenge, rpId, origin });
  if (publicKey === null) return fail(400, m.auth.badPasskey);
  if (pending !== undefined) {
    if (await keyChangeMayLand(db, user.id)) return fail(409, m.errors.onItsWay);
    await db.delete(credentials).where(and(eq(credentials.id, pending.id), eq(credentials.state, "pending")));
  }
  try {
    await db.insert(credentials).values({ id: input.credentialId, userId: user.id, publicKey, userHandle: input.userHandle, rpId, state: "pending" });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, m.errors.onItsWay); // another start of theirs got its pending passkey in first
    throw error;
  }
  session.keyChange = input.credentialId;
  await session.save();
  return { ok: true, publicKey };
}

/**
 * Whether one of this person's key changes is on its way (sent, with no receipt yet) or landed: either way the Safe
 * may hold the pending key. Only a failed one changed nothing.
 */
async function keyChangeMayLand(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userOpHash: operations.userOpHash })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.kind, "key-change"),
        or(isNull(operations.success), eq(operations.success, true)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Marks this session ready for the key change once it proves it holds the pending passkey: its answer to this
 * session's challenge, checked against the pending passkey's key and site. For a change resumed in another visit or
 * on another phone (spec, 9.5).
 */
export async function proveKeyChange({
  db,
  session,
  user,
  assertion,
  origin,
  now = Date.now(),
  m,
}: {
  db: Db;
  session: Session;
  user: { id: string };
  assertion: PasskeyAssertion;
  origin: string;
  now?: number;
  m: Messages;
}): Promise<AuthResult> {
  const challenge = takeChallenge(session, now);
  if (challenge === null) {
    await session.save();
    return { ok: false, status: 400, error: m.auth.late };
  }
  const { pending } = await passkeysOf(db, user.id);
  if (
    pending === undefined ||
    assertion.credentialId !== pending.id ||
    !isValidAnswer({ assertion, publicKey: pending.publicKey, challenge, rpId: pending.rpId, origin })
  ) {
    await session.save();
    return { ok: false, status: 401, error: m.auth.unknownPasskey };
  }
  session.keyChange = pending.id;
  await session.save();
  return { ok: true, userId: user.id };
}

/**
 * Makes the pending passkey the active one once the chain shows the Safe holds its key, and retires the one it
 * replaces: "changed". "waiting" while the Safe holds another key (or isn't deployed), "none" with nothing pending.
 * Never from the browser's word: from `readKey`, the Safe's key as the chain has it.
 *
 * The active one is retired first, as a person has at most one (credentials_one_active), in one transaction with the
 * second update. A pending passkey with no active one, as a cut between the two would leave it, is finished without
 * the chain: only a call that read the chain retires the active one.
 */
export async function confirmKeyChange(
  db: Db,
  user: { id: string; account: Address },
  readKey: (account: Address) => Promise<SafeKey>,
): Promise<"changed" | "waiting" | "none"> {
  const { active, pending } = await passkeysOf(db, user.id);
  if (pending === undefined) return "none";
  const activate = (tx: Db) =>
    tx.update(credentials).set({ state: "active" }).where(and(eq(credentials.id, pending.id), eq(credentials.state, "pending")));
  if (active === undefined) {
    await activate(db);
    return "changed";
  }
  if (!isSafeKey(await readKey(user.account), pending.publicKey)) return "waiting";
  await inTransaction(db, (tx) => [
    tx.update(credentials).set({ state: "retired" }).where(and(eq(credentials.id, active.id), eq(credentials.state, "active"))),
    activate(tx),
  ]);
  return "changed";
}

/** The pending passkey's key if this session made or proved it (`ready`), or null: the one key change /api/bundler sponsors. */
export async function keyChangeKeyFor(db: Db, user: { id: string }, session: Pick<Session, "keyChange">): Promise<Hex | null> {
  const { pending } = await passkeysOf(db, user.id);
  return pending !== undefined && session.keyChange === pending.id ? pending.publicKey : null;
}
