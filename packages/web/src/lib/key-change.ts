import { type PasskeyAssertion, type SafeKey, isSafeKey } from "@tesoreria/wallet";
import { and, eq, exists, inArray, isNull, notExists, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
 * - `onItsWay`: while a passkey is pending, a key change of theirs was sent with no receipt yet, or landed. Meanwhile
 *   the pending passkey isn't replaced (`startKeyChange`): the page waits instead of making another.
 */
export type KeyChangeState = {
  due: boolean;
  pending: { id: string; rpId: string; publicKey: Hex } | null;
  ready: boolean;
  onItsWay: boolean;
};

/** The new passkey, as the page posts it. Unlike a registration's, never without its attestation: no older page starts a key change. */
export type KeyChangeInput = Required<NewPasskey>;

/** The Safe's key as the chain has it now (`readSafeKey`). */
export type SafeKeyReader = (account: Address) => Promise<SafeKey>;

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
 * This person's key changes that may have reached the chain: sent with no receipt yet (they can still land), or
 * landed. Only a failed one changed nothing. Whoever records it, the page or the server, the row is the same.
 */
function keyChangesThatMayLand(db: Db, userId: string) {
  return db
    .select({ userOpHash: operations.userOpHash })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.kind, "key-change"),
        or(isNull(operations.success), eq(operations.success, true)),
      ),
    );
}

/**
 * `due` once the site's passkeys are of another site than the person's active one, the old site's, and, while
 * KEY_CHANGE_PILOT (`pilot`) is set, only for that account: anyone else goes on with their old passkey (spec, 9.5).
 * `onItsWay` only with a pending passkey: once the swap is confirmed, its operation is over, receipt or not.
 */
export async function keyChangeOf(
  db: Db,
  user: { id: string; account: Address },
  session: Pick<Session, "keyChange">,
  { rpId, pilot }: { rpId: string; pilot?: Address },
): Promise<KeyChangeState> {
  const { active, pending } = await passkeysOf(db, user.id);
  const onItsWay = pending !== undefined && (await keyChangesThatMayLand(db, user.id).limit(1)).length > 0;
  return {
    due: active?.rpId === LEGACY_RP_ID && rpId !== LEGACY_RP_ID && (pilot === undefined || isAddressEqual(pilot, user.account)),
    pending: pending ?? null,
    ready: pending !== undefined && session.keyChange === pending.id,
    onItsWay,
  };
}

/**
 * Keeps the new passkey a person just made as their pending one, and marks this session ready (spec, 9.5). It takes
 * one whose active passkey is the old site's, and checks the new one as a registration does (`attestedKey`): for
 * `rpId`, on this session's challenge.
 *
 * A pending passkey from before is replaced only if nothing says the Safe holds, or may come to hold, its key: a
 * Safe has one owner and no recovery, and it would be left with the key of a passkey the server forgot.
 * - The chain is read first (`readKey`). If the Safe holds that key, the change is confirmed instead and the start
 *   refused; if the chain can't be read, the start is refused too.
 * - The delete itself checks that no key change of theirs is on its way or landed, so one recorded after the read
 *   still keeps the pending passkey.
 */
export async function startKeyChange({
  db,
  session,
  user,
  input,
  rpId,
  origin,
  now = Date.now(),
  readKey,
  m,
}: {
  db: Db;
  session: Session;
  user: { id: string; account: Address };
  input: KeyChangeInput;
  rpId: string;
  origin: string;
  now?: number;
  readKey: SafeKeyReader;
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
    let held: boolean;
    try {
      held = isSafeKey(await readKey(user.account), pending.publicKey);
    } catch {
      return fail(503, m.errors.generic); // without the chain, nothing is replaced
    }
    if (held) {
      await activate(db, user.id, pending.id);
      return fail(409, m.errors.generic); // changed already: no old-site passkey is left to change
    }
    const deleted = await db
      .delete(credentials)
      .where(and(eq(credentials.id, pending.id), eq(credentials.state, "pending"), notExists(keyChangesThatMayLand(db, user.id))))
      .returning({ id: credentials.id });
    if (deleted.length === 0) return fail(409, m.errors.onItsWay);
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
 * Never from the browser's word, nor without the chain: only `readKey`, the Safe's key as the chain has it, makes a
 * passkey active. That includes a pending passkey with no active one, as a cut between the two updates would leave it.
 */
export async function confirmKeyChange(db: Db, user: { id: string; account: Address }, readKey: SafeKeyReader): Promise<"changed" | "waiting" | "none"> {
  const { pending } = await passkeysOf(db, user.id);
  if (pending === undefined) return "none";
  if (!isSafeKey(await readKey(user.account), pending.publicKey)) return "waiting";
  return (await activate(db, user.id, pending.id)) ? "changed" : "none";
}

/**
 * The pending passkey becomes active, and the active one is retired first, as a person has at most one
 * (credentials_one_active), in one transaction. The retirement waits on the pending passkey still being pending, so
 * if it went meanwhile, nothing changes. Whether the pending passkey is the active one afterwards.
 */
async function activate(db: Db, userId: string, pendingId: string): Promise<boolean> {
  const stillPending = alias(credentials, "still_pending");
  const [, activated] = await inTransaction(db, (tx) => [
    tx
      .update(credentials)
      .set({ state: "retired" })
      .where(
        and(
          eq(credentials.userId, userId),
          eq(credentials.state, "active"),
          exists(tx.select({ id: stillPending.id }).from(stillPending).where(and(eq(stillPending.id, pendingId), eq(stillPending.state, "pending")))),
        ),
      ),
    tx
      .update(credentials)
      .set({ state: "active" })
      .where(and(eq(credentials.id, pendingId), eq(credentials.state, "pending")))
      .returning({ id: credentials.id }),
  ]);
  if (activated.length > 0) return true;
  // Another confirmation got there first, or the pending passkey is gone: the database says which.
  return (await passkeysOf(db, userId)).active?.id === pendingId;
}

/** The pending passkey's key if this session made or proved it (`ready`), or null: the one key change /api/bundler sponsors. */
export async function keyChangeKeyFor(db: Db, user: { id: string }, session: Pick<Session, "keyChange">): Promise<Hex | null> {
  const { pending } = await passkeysOf(db, user.id);
  return pending !== undefined && session.keyChange === pending.id ? pending.publicKey : null;
}
