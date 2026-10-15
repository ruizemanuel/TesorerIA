import { signPasskeyChallenge } from "@tesoreria/wallet";
import { createFakePasskey } from "@tesoreria/wallet/testing";
import { Base64 } from "ox";
import { type Hex, getAddress, keccak256, slice, toHex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CHALLENGE_TTL_MS,
  type DeriveAccount,
  type Registration,
  issueChallenge,
  logIn,
  registerMember,
} from "../src/lib/auth";
import type { Db } from "../src/lib/db/client";
import { credentials, users } from "../src/lib/db/schema";
import { en } from "../src/lib/i18n/en";
import { type Messages, es } from "../src/lib/i18n/es";
import { testDb } from "./support/db";
import { fakeSession } from "./support/session";

const RP_ID = "localhost";
const ORIGIN = "http://localhost"; // what the fake authenticator puts in clientDataJSON
const NOW = 1_791_640_000_000;

/** Like the real one, a different account per public key; no RPC. */
const deriveAccount: DeriveAccount = async ({ publicKey }) => getAddress(slice(keccak256(publicKey), 12));

function creation(challenge: Hex, origin = ORIGIN, type = "webauthn.create") {
  return JSON.stringify({ type, challenge: Base64.fromHex(challenge, { url: true, pad: false }), origin, crossOrigin: false });
}

// Every test makes its own people (a fresh passkey each), so they can share one database.
let db: Db;
beforeAll(async () => {
  db = await testDb();
});

async function register(
  passkey = createFakePasskey(),
  change: { origin?: string; type?: string; now?: number; input?: Partial<Registration>; db?: Db; m?: Messages } = {},
) {
  const session = fakeSession();
  const challenge = issueChallenge(session, NOW);
  const input = {
    name: "Ema",
    credentialId: passkey.credential.id,
    publicKey: passkey.credential.publicKey,
    userHandle: toHex(crypto.getRandomValues(new Uint8Array(16))),
    clientDataJSON: creation(challenge, change.origin, change.type),
    ...change.input,
  };
  const result = await registerMember({ db: change.db ?? db, session, input, deriveAccount, origin: ORIGIN, now: change.now ?? NOW, m: change.m ?? es });
  return { result, session, passkey };
}

/**
 * The shared database, but its "is it taken?" lookups find nothing, as if two registrations raced between the
 * check and the insert. With `failing`, inserts into that table throw `error` as a database outage would.
 */
function racing(failing?: { table: typeof users | typeof credentials; error: Error }): Db {
  const nothing = { from: () => ({ where: async () => [] }) };
  const outage = (error: Error) => ({
    returning: () => Promise.reject(error),
    then: (resolve: never, reject: (reason: unknown) => void) => Promise.reject(error).then(resolve, reject),
  });
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "select") return () => nothing;
      if (prop === "insert" && failing) {
        return (table: typeof users | typeof credentials) =>
          table === failing.table ? { values: () => outage(failing.error) } : target.insert(table as never);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const countUsers = async () => (await db.select().from(users)).length;

describe("registerMember", () => {
  it("creates the person with the account derived on the server, and starts their session", async () => {
    const { result, session } = await register();
    expect(result.ok).toBe(true);
    expect(session.userId).toBe(result.ok ? result.userId : undefined);
    expect(session.challenge).toBeUndefined();
  });

  it("refuses an old challenge, another ceremony, another origin, and a key whose account already exists", async () => {
    expect((await register(createFakePasskey(), { now: NOW + CHALLENGE_TTL_MS + 1 })).result).toMatchObject({ ok: false, status: 400 });
    expect((await register(createFakePasskey(), { type: "webauthn.get" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await register(createFakePasskey(), { origin: "https://evil.example" })).result).toMatchObject({ ok: false, status: 400 });
    const passkey = createFakePasskey();
    expect((await register(passkey)).result.ok).toBe(true);
    const again = await register({ ...passkey, credential: { ...passkey.credential, id: "another-credential" } });
    expect(again.result).toMatchObject({ ok: false, status: 409 });
    expect(again.session.userId).toBeUndefined();
  });

  it("uses the challenge once, even when the answer is refused", async () => {
    const refused = await register(createFakePasskey(), { origin: "https://evil.example" });
    expect(refused.result.ok).toBe(false);
    expect(refused.session.challenge).toBeUndefined();
    expect(refused.session.saved).toBeGreaterThan(0);
    // After a good registration the same session has no challenge left to register another person.
    const { session } = await register();
    const other = createFakePasskey();
    const input = {
      name: "Otra",
      credentialId: other.credential.id,
      publicKey: other.credential.publicKey,
      userHandle: toHex(crypto.getRandomValues(new Uint8Array(16))),
      clientDataJSON: creation(issueChallenge(fakeSession(), NOW)),
    };
    expect(await registerMember({ db, session, input, deriveAccount, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a name, an email, a key or a user handle that doesn't fit", async () => {
    const bad = (input: Partial<Registration>) => register(createFakePasskey(), { input });
    expect((await bad({ name: "   " })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ name: "x".repeat(31) })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ email: "not-a-mail" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ publicKey: "0x1234" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ userHandle: "0x1234" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ clientDataJSON: "not json" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ email: " ema@example.com " })).result.ok).toBe(true);
  });

  it("refuses someone else's credential id without leaving a person behind", async () => {
    const mine = createFakePasskey();
    expect((await register(mine)).result.ok).toBe(true);
    const before = (await db.select().from(users)).length;
    const taken = await register(createFakePasskey(), { input: { credentialId: mine.credential.id } });
    expect(taken.result).toMatchObject({ ok: false, status: 409 });
    expect(taken.session.userId).toBeUndefined();
    expect((await db.select().from(users)).length).toBe(before);
  });

  it("answers 409 only for a unique violation, wherever the race is lost", async () => {
    const mine = createFakePasskey();
    expect((await register(mine)).result.ok).toBe(true);
    const before = await countUsers();
    // The same account, past the lookups: the unique column refuses it.
    const sameKey = await register({ ...mine, credential: { ...mine.credential, id: "other-id" } }, { db: racing() });
    expect(sameKey.result).toMatchObject({ ok: false, status: 409 });
    // Another key under the registered credential id: the person goes in, the passkey is refused, the person comes out.
    const sameCredential = await register(createFakePasskey(), { db: racing(), input: { credentialId: mine.credential.id } });
    expect(sameCredential.result).toMatchObject({ ok: false, status: 409 });
    expect(sameCredential.session.userId).toBeUndefined();
    expect(await countUsers()).toBe(before);
  });

  it("lets any other database error through instead of calling it a taken passkey, and leaves no person behind", async () => {
    const outage = new Error("connection reset");
    const before = await countUsers();
    await expect(register(createFakePasskey(), { db: racing({ table: users, error: outage }) })).rejects.toThrow("connection reset");
    await expect(register(createFakePasskey(), { db: racing({ table: credentials, error: outage }) })).rejects.toThrow("connection reset");
    expect(await countUsers()).toBe(before);
  });
});

describe("logIn", () => {
  it("lets a member in with their passkey, once per challenge", async () => {
    const { result, passkey } = await register();
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
    const first = await logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW, m: es });
    expect(first).toEqual({ ok: true, userId: result.ok ? result.userId : "" });
    expect(session.userId).toBe(result.ok ? result.userId : undefined);
    // The same assertion again: the challenge it answered is gone, and a new one is not what it signed.
    expect(await logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 400 });
    const replay = fakeSession();
    issueChallenge(replay, NOW);
    expect(await logIn({ db, session: replay, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 401 });
    expect(replay.userId).toBeUndefined();
  });

  it("keeps out another origin, an unknown passkey and a late answer", async () => {
    const { passkey } = await register();
    const attempt = async (getFn = passkey.getFn, { origin = ORIGIN, late = 0 } = {}) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn });
      const result = await logIn({ db, session, assertion, rpId: RP_ID, origin, now: NOW + late, m: es });
      return { result, session };
    };
    expect((await attempt(passkey.getFn, { origin: "http://localhost:3000" })).result).toMatchObject({ ok: false, status: 401 });
    expect((await attempt(createFakePasskey().getFn)).result).toMatchObject({ ok: false, status: 401 });
    const late = await attempt(passkey.getFn, { late: CHALLENGE_TTL_MS + 1 });
    expect(late.result).toMatchObject({ ok: false, status: 400 });
    expect(late.session.userId).toBeUndefined();
  });

  it("answers at the edge of the five minutes, and not a millisecond later", async () => {
    const { passkey } = await register();
    const attempt = async (late: number) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
      return logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW + late, m: es });
    };
    expect((await attempt(CHALLENGE_TTL_MS)).ok).toBe(true);
    expect((await attempt(CHALLENGE_TTL_MS + 1)).ok).toBe(false);
  });

  it("burns the challenge when the answer is wrong, so a right answer can't follow it", async () => {
    const { passkey } = await register();
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
    const wrongOrigin = await logIn({ db, session, assertion, rpId: RP_ID, origin: "https://evil.example", now: NOW, m: es });
    expect(wrongOrigin).toMatchObject({ ok: false, status: 401 });
    expect(session.challenge).toBeUndefined();
    expect(await logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 400 });
    expect(session.userId).toBeUndefined();
  });

  it("answers 401, never an exception, to a malformed assertion", async () => {
    const { passkey } = await register();
    const attempt = async (change: Partial<Awaited<ReturnType<typeof signPasskeyChallenge>>>) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
      const result = await logIn({ db, session, assertion: { ...assertion, ...change }, rpId: RP_ID, origin: ORIGIN, now: NOW, m: es });
      return { result, session };
    };
    for (const change of [
      { authenticatorData: "0xzz" as Hex },
      { authenticatorData: "0x" as Hex },
      { signature: "0x12" as Hex },
      { signature: "nothex" as Hex },
      { clientDataJSON: "null" },
      { clientDataJSON: "not json" },
      { clientDataJSON: "[]" },
    ]) {
      const { result, session } = await attempt(change);
      expect(result, JSON.stringify(change)).toMatchObject({ ok: false, status: 401 });
      expect(session.userId).toBeUndefined();
      expect(session.challenge).toBeUndefined();
    }
  });

  it("refuses a login nobody asked a challenge for", async () => {
    const { passkey } = await register();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(fakeSession(), NOW), rpId: RP_ID, getFn: passkey.getFn });
    expect(await logIn({ db, session: fakeSession(), assertion, rpId: RP_ID, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 400 });
  });

  it("keeps out another passkey that claims to be a member's", async () => {
    const { passkey } = await register();
    const session = fakeSession();
    const signed = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: createFakePasskey().getFn });
    const assertion = { ...signed, credentialId: passkey.credential.id };
    expect(await logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 401 });
    expect(session.userId).toBeUndefined();
  });

  it("keeps out an answer made for another site", async () => {
    const attempt = async (passkey: ReturnType<typeof createFakePasskey>, signedFor: string, serverRpId: string) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: signedFor, getFn: passkey.getFn });
      const result = await logIn({ db, session, assertion, rpId: serverRpId, origin: ORIGIN, now: NOW, m: es });
      return { result, session };
    };
    // The right passkey, but the server expects another site than the one it signed for.
    const member = (await register()).passkey;
    const wrongServer = await attempt(member, RP_ID, "tesoreria.example");
    expect(wrongServer.result).toMatchObject({ ok: false, status: 401 });
    expect(wrongServer.session.userId).toBeUndefined();
    // A registered passkey whose authenticator signed for another site: only the rpId hash differs.
    const foreign = createFakePasskey({ rpId: "evil.example" });
    expect((await register(foreign)).result.ok).toBe(true);
    const wrongAuthenticator = await attempt(foreign, "evil.example", RP_ID);
    expect(wrongAuthenticator.result).toMatchObject({ ok: false, status: 401 });
    expect(wrongAuthenticator.session.userId).toBeUndefined();
    // Control: the same passkey is let in on the site it signed for.
    expect((await attempt(foreign, "evil.example", "evil.example")).result.ok).toBe(true);
  });
});

describe("in the language of the dictionary", () => {
  it("says why a registration was refused, in Spanish and in English", async () => {
    const refused = async (change: Parameters<typeof register>[1], m: Messages) => (await register(createFakePasskey(), { ...change, m })).result;
    const stale = { now: NOW + CHALLENGE_TTL_MS + 1 };
    expect(await refused(stale, es)).toEqual({ ok: false, status: 400, error: "Pasó demasiado tiempo. Probá de nuevo." });
    expect(await refused(stale, en)).toEqual({ ok: false, status: 400, error: en.auth.late });
    expect(await refused({ origin: "https://evil.example" }, es)).toEqual({ ok: false, status: 400, error: "No pudimos crear tu passkey. Probá de nuevo." });
    expect(await refused({ origin: "https://evil.example" }, en)).toEqual({ ok: false, status: 400, error: en.auth.badPasskey });
    expect(await refused({ input: { name: "   " } }, en)).toEqual({ ok: false, status: 400, error: en.checks.personName });
    expect(await refused({ input: { email: "not-a-mail" } }, en)).toEqual({ ok: false, status: 400, error: en.checks.personEmail });

    const mine = createFakePasskey();
    expect((await register(mine)).result.ok).toBe(true);
    const same = { credentialId: mine.credential.id };
    expect((await register(createFakePasskey(), { input: same })).result).toEqual({ ok: false, status: 409, error: "Esa passkey ya tiene una cuenta. Entrá con ella." });
    expect((await register(createFakePasskey(), { input: same, m: en })).result).toEqual({ ok: false, status: 409, error: en.auth.taken });
  });

  it("says why a login was refused, in Spanish and in English", async () => {
    const attempt = async (m: Messages, late = 0) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: createFakePasskey().getFn });
      return logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW + late, m });
    };
    expect(await attempt(es)).toEqual({ ok: false, status: 401, error: "No pudimos reconocer tu passkey." });
    expect(await attempt(en)).toEqual({ ok: false, status: 401, error: en.auth.unknownPasskey });
    expect(await attempt(en, CHALLENGE_TTL_MS + 1)).toEqual({ ok: false, status: 400, error: en.auth.late });
  });
});
