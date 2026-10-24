import { type Attestation, type PasskeyAssertion, readAttestation, verifyPasskeyAssertion } from "@tesoreria/wallet";
import { eq } from "drizzle-orm";
import { Base64, Hex as OxHex } from "ox";
import { type Address, type Hex, isHex, sha256, size, stringToBytes } from "viem";
import { personProblem } from "./checks";
import type { Db } from "./db/client";
import { credentials, users } from "./db/schema";
import type { Messages } from "./i18n/messages";
import type { Session } from "./session";

export const CHALLENGE_TTL_MS = 5 * 60_000;

export type AuthResult = { ok: true; userId: string } | { ok: false; status: number; error: string };

/** Derives a member's Safe from their passkey. On the server, never from the browser's word. */
export type DeriveAccount = (credential: { id: string; publicKey: Hex }) => Promise<Address>;

/** A passkey a creation ceremony just made, as the page posts it. */
export type NewPasskey = {
  credentialId: string;
  /**
   * What the authenticator answered the creation with: the passkey's key is read from here, never from a field the
   * browser fills in. Missing only from a page whose JavaScript predates it, which is refused as a bad passkey.
   */
  attestationObject?: Hex;
  /** The random user.id the authenticator got, 16 bytes. */
  userHandle: Hex;
  /** The creation ceremony's client data, to check its challenge and origin. */
  clientDataJSON: string;
};

export type Registration = NewPasskey & { name: string; email?: string };

/** A fresh challenge for the next passkey ceremony; the caller saves the session. */
export function issueChallenge(session: Session, now = Date.now()): Hex {
  const challenge = OxHex.random(32);
  session.challenge = challenge;
  session.challengeAt = now;
  return challenge;
}

/** The pending challenge, once: it's cleared whether or not it's still fresh, so an answer can't be replayed. */
export function takeChallenge(session: Session, now: number): Hex | null {
  const { challenge, challengeAt } = session;
  session.challenge = undefined;
  session.challengeAt = undefined;
  if (challenge === undefined || challengeAt === undefined || now - challengeAt > CHALLENGE_TTL_MS) return null;
  return challenge;
}

/** Creates the person, their passkey and their account (derived here), and starts their session (spec, 6). */
export async function registerMember({
  db,
  session,
  input,
  deriveAccount,
  rpId,
  origin,
  now = Date.now(),
  m,
}: {
  db: Db;
  session: Session;
  input: Registration;
  deriveAccount: DeriveAccount;
  /** The site the new passkey has to be made for (its attestation says which): kept with it. */
  rpId: string;
  origin: string;
  now?: number;
  m: Messages;
}): Promise<AuthResult> {
  const challenge = takeChallenge(session, now);
  const fail = async (status: number, error: string): Promise<AuthResult> => {
    await session.save();
    return { ok: false, status, error };
  };
  if (challenge === null) return fail(400, m.auth.late);
  const problem = personProblem(input, m); // the same check the form ran before making the passkey
  if (problem !== null) return fail(400, problem);
  const name = input.name.trim();
  const email = input.email?.trim() || undefined;
  const publicKey = attestedKey(input, { challenge, rpId, origin });
  if (publicKey === null) return fail(400, m.auth.badPasskey);

  const account = await deriveAccount({ id: input.credentialId, publicKey });
  // A credential id someone else registered would leave a person without a passkey behind: check it first.
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.account, account));
  const known = await db.select({ id: credentials.id }).from(credentials).where(eq(credentials.id, input.credentialId));
  if (taken.length > 0 || known.length > 0) return fail(409, m.auth.taken);
  let userId: string;
  try {
    const [user] = await db.insert(users).values({ name, email, account }).returning({ id: users.id });
    userId = user!.id;
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, m.auth.taken); // someone registered the same account in the meantime
    throw error;
  }
  try {
    await db
      .insert(credentials)
      .values({ id: input.credentialId, userId, publicKey, userHandle: input.userHandle, rpId, state: "active" });
  } catch (error) {
    // No transactions over Neon's HTTP driver: take the person we just added out again, so none is left without a passkey.
    await db.delete(users).where(eq(users.id, userId)).catch(() => undefined);
    if (isUniqueViolation(error)) return fail(409, m.auth.taken);
    throw error;
  }
  session.userId = userId;
  await session.save();
  return { ok: true, userId };
}

/**
 * The key of the passkey a creation ceremony made, read from its attestation, if it is the one this site asked for:
 * made for `rpId`, with the person verified, under the id the page says, with a 16-byte user handle, and answering
 * `challenge` from `origin`. Null otherwise, which is a passkey we can't take. A registration and a key change
 * (key-change.ts) both check a new passkey with it.
 */
export function attestedKey(input: NewPasskey, { challenge, rpId, origin }: { challenge: Hex; rpId: string; origin: string }): Hex | null {
  const attestation = attestationOf(input.attestationObject);
  if (
    attestation === null ||
    attestation.rpIdHash !== sha256(stringToBytes(rpId)) ||
    !attestation.userVerified ||
    attestation.credentialId !== input.credentialId
  ) {
    return null;
  }
  if (!isHex(input.userHandle) || size(input.userHandle) !== 16) return null;
  let client: { type?: unknown; challenge?: unknown; origin?: unknown } | null;
  try {
    client = JSON.parse(input.clientDataJSON);
  } catch {
    return null;
  }
  if (
    client?.type !== "webauthn.create" ||
    client.origin !== origin ||
    client.challenge !== Base64.fromHex(challenge, { url: true, pad: false })
  ) {
    return null;
  }
  return attestation.publicKey;
}

/** `readAttestation` throws on anything that isn't the attestation of a P-256 passkey; for a new passkey that is one we can't take. */
function attestationOf(attestationObject: Hex | undefined): Attestation | null {
  if (attestationObject === undefined) return null;
  try {
    return readAttestation(attestationObject);
  } catch {
    return null;
  }
}

/**
 * Postgres' unique_violation (23505). The driver's error carries the code, and drizzle wraps it as the `cause`
 * of its own, so both are looked at. Anything else (an outage, a bug) is not a taken passkey and must surface.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let depth = 0; depth < 3 && typeof error === "object" && error !== null; depth++) {
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (code === "23505") return true;
    error = cause;
  }
  return false;
}

/**
 * Checks a passkey's answer to this session's challenge, and starts the session (spec, 6). Each passkey is checked
 * against the site it was made for, so one from tesoreriaia.vercel.app still logs in on tesoreria.finance (spec, 9.5).
 * A pending passkey is the person's own, proved by its signature, and a session that logs in with it is ready for the
 * key change (key-change.ts). Only an active or a pending one is accepted: a retired one, or a state this code doesn't
 * name (the column is plain text), keeps the passkey out.
 */
export async function logIn({
  db,
  session,
  assertion,
  origin,
  now = Date.now(),
  m,
}: {
  db: Db;
  session: Session;
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
  const [row] = await db.select().from(credentials).where(eq(credentials.id, assertion.credentialId));
  if (
    row === undefined ||
    (row.state !== "active" && row.state !== "pending") ||
    !isValidAnswer({ assertion, publicKey: row.publicKey as Hex, challenge, rpId: row.rpId, origin })
  ) {
    await session.save();
    return { ok: false, status: 401, error: m.auth.unknownPasskey };
  }
  session.userId = row.userId;
  // It signed this session's challenge, which proves the pending passkey as `proveKeyChange` does.
  if (row.state === "pending") session.keyChange = row.id;
  await session.save();
  return { ok: true, userId: row.userId };
}

/** `verifyPasskeyAssertion` throws on some malformed input; for a login or a proof that is just an answer that doesn't verify. */
export function isValidAnswer(args: Parameters<typeof verifyPasskeyAssertion>[0]): boolean {
  try {
    return verifyPasskeyAssertion(args);
  } catch {
    return false;
  }
}
