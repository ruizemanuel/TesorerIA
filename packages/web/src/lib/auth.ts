import { type PasskeyAssertion, verifyPasskeyAssertion } from "@tesoreria/wallet";
import { eq } from "drizzle-orm";
import { Base64, Hex as OxHex } from "ox";
import { type Address, type Hex, isHex, size } from "viem";
import type { Db } from "./db/client";
import { credentials, users } from "./db/schema";
import type { Session } from "./session";

export const CHALLENGE_TTL_MS = 5 * 60_000;

export type AuthResult = { ok: true; userId: string } | { ok: false; status: number; error: string };

/** Derives a member's Safe from their passkey. On the server, never from the browser's word. */
export type DeriveAccount = (credential: { id: string; publicKey: Hex }) => Promise<Address>;

export type Registration = {
  name: string;
  email?: string;
  credentialId: string;
  /** 0x + x ‖ y, as viem's createWebAuthnCredential returns it. */
  publicKey: Hex;
  /** The random user.id the authenticator got, 16 bytes. */
  userHandle: Hex;
  /** The creation ceremony's client data, to check its challenge and origin. */
  clientDataJSON: string;
};

/** A fresh challenge for the next passkey ceremony; the caller saves the session. */
export function issueChallenge(session: Session, now = Date.now()): Hex {
  const challenge = OxHex.random(32);
  session.challenge = challenge;
  session.challengeAt = now;
  return challenge;
}

/** The pending challenge, once: it's cleared whether or not it's still fresh, so an answer can't be replayed. */
function takeChallenge(session: Session, now: number): Hex | null {
  const { challenge, challengeAt } = session;
  session.challenge = undefined;
  session.challengeAt = undefined;
  if (challenge === undefined || challengeAt === undefined || now - challengeAt > CHALLENGE_TTL_MS) return null;
  return challenge;
}

const LATE = "Pasó demasiado tiempo. Probá de nuevo.";
const BAD_PASSKEY = "No pudimos crear tu passkey. Probá de nuevo.";
const TAKEN = "Esa passkey ya tiene una cuenta. Entrá con ella.";

/** Creates the person, their passkey and their account (derived here), and starts their session (spec, 6). */
export async function registerMember({
  db,
  session,
  input,
  deriveAccount,
  origin,
  now = Date.now(),
}: {
  db: Db;
  session: Session;
  input: Registration;
  deriveAccount: DeriveAccount;
  origin: string;
  now?: number;
}): Promise<AuthResult> {
  const challenge = takeChallenge(session, now);
  const fail = async (status: number, error: string): Promise<AuthResult> => {
    await session.save();
    return { ok: false, status, error };
  };
  if (challenge === null) return fail(400, LATE);
  const name = input.name.trim();
  if (name.length === 0 || name.length > 30) return fail(400, "Poné tu nombre, de hasta 30 letras.");
  const email = input.email?.trim() || undefined;
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "Ese mail no parece válido.");
  if (!isHex(input.publicKey) || size(input.publicKey) !== 64) return fail(400, BAD_PASSKEY);
  if (!isHex(input.userHandle) || size(input.userHandle) !== 16) return fail(400, BAD_PASSKEY);
  let client: { type?: unknown; challenge?: unknown; origin?: unknown } | null;
  try {
    client = JSON.parse(input.clientDataJSON);
  } catch {
    return fail(400, BAD_PASSKEY);
  }
  if (
    client?.type !== "webauthn.create" ||
    client.origin !== origin ||
    client.challenge !== Base64.fromHex(challenge, { url: true, pad: false })
  ) {
    return fail(400, BAD_PASSKEY);
  }

  const account = await deriveAccount({ id: input.credentialId, publicKey: input.publicKey });
  // A credential id someone else registered would leave a person without a passkey behind: check it first.
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.account, account));
  const known = await db.select({ id: credentials.id }).from(credentials).where(eq(credentials.id, input.credentialId));
  if (taken.length > 0 || known.length > 0) return fail(409, TAKEN);
  try {
    const [user] = await db.insert(users).values({ name, email, account }).returning({ id: users.id });
    await db
      .insert(credentials)
      .values({ id: input.credentialId, userId: user!.id, publicKey: input.publicKey, userHandle: input.userHandle });
    session.userId = user!.id;
    await session.save();
    return { ok: true, userId: user!.id };
  } catch {
    return fail(409, TAKEN); // someone registered the same account in the meantime: the unique columns decide
  }
}

/** Checks a passkey's answer to this session's challenge, and starts the session (spec, 6). */
export async function logIn({
  db,
  session,
  assertion,
  rpId,
  origin,
  now = Date.now(),
}: {
  db: Db;
  session: Session;
  assertion: PasskeyAssertion;
  rpId: string;
  origin: string;
  now?: number;
}): Promise<AuthResult> {
  const challenge = takeChallenge(session, now);
  if (challenge === null) {
    await session.save();
    return { ok: false, status: 400, error: LATE };
  }
  const [row] = await db.select().from(credentials).where(eq(credentials.id, assertion.credentialId));
  if (row === undefined || !isValidAnswer({ assertion, publicKey: row.publicKey as Hex, challenge, rpId, origin })) {
    await session.save();
    return { ok: false, status: 401, error: "No pudimos reconocer tu passkey." };
  }
  session.userId = row.userId;
  await session.save();
  return { ok: true, userId: row.userId };
}

/** `verifyPasskeyAssertion` throws on some malformed input; for a login that is just an answer that doesn't verify. */
function isValidAnswer(args: Parameters<typeof verifyPasskeyAssertion>[0]): boolean {
  try {
    return verifyPasskeyAssertion(args);
  } catch {
    return false;
  }
}
