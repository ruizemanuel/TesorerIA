import { signPasskeyChallenge } from "@tesoreria/wallet";
import { type FakePasskey, createFakePasskey } from "@tesoreria/wallet/testing";
import { eq, sql } from "drizzle-orm";
import { Base64, Bytes, Cbor } from "ox";
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
import { LEGACY_RP_ID } from "../src/lib/passkey-sites";
import { addUser, testDb } from "./support/db";
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

/**
 * The passkey as another authenticator reports it: the same key, with its attested data changed. The fake makes a
 * well-formed attestation; this is how a test gets one that is not.
 */
function altered(passkey: FakePasskey, change: (authData: Uint8Array) => Uint8Array, id = passkey.credential.id): FakePasskey {
  return {
    ...passkey,
    credential: { ...passkey.credential, id },
    attest: (options) => {
      const made = passkey.attest(options);
      const { authData, ...rest } = Cbor.decode(made.attestationObject) as { authData: Uint8Array };
      return { ...made, attestationObject: Cbor.encode({ ...rest, authData: change(authData) }) };
    },
  };
}

// authenticator data: rpIdHash (32) ‖ flags (1) ‖ signCount (4) ‖ aaguid (16) ‖ id length (2) ‖ id ‖ COSE key
const FLAGS = 32;
const ID_LENGTH = 53;
const KEY = 71; // after a 16-byte credential id, which is the fake's

/** Another credential id for the same key, in the attestation as well as in the passkey. */
function underAnotherId(passkey: FakePasskey, id = Base64.fromBytes(Bytes.random(16), { url: true, pad: false })): FakePasskey {
  const rawId = Base64.toBytes(id);
  return altered(passkey, (authData) => Bytes.concat(authData.slice(0, ID_LENGTH), Bytes.fromNumber(rawId.length, { size: 2 }), rawId, authData.slice(KEY)), id);
}

async function register(
  passkey = createFakePasskey(),
  change: { origin?: string; type?: string; now?: number; rpId?: string; input?: Partial<Registration>; db?: Db; m?: Messages } = {},
) {
  const session = fakeSession();
  const challenge = issueChallenge(session, NOW);
  const attested = passkey.attest({ challenge, origin: change.origin });
  const input = {
    name: "Ema",
    credentialId: passkey.credential.id,
    userHandle: toHex(crypto.getRandomValues(new Uint8Array(16))),
    attestationObject: attested.attestationObject,
    clientDataJSON: change.type === undefined ? attested.clientDataJSON : creation(challenge, change.origin, change.type),
    ...change.input,
  };
  const result = await registerMember({ db: change.db ?? db, session, input, deriveAccount, rpId: change.rpId ?? RP_ID, origin: ORIGIN, now: change.now ?? NOW, m: change.m ?? es });
  return { result, session, passkey };
}

/** Stores a passkey row as it is found in the database: with the site it belongs to, and as old, pending or retired as the case needs. */
async function addPasskey(passkey: FakePasskey, { rpId, state, userId }: { rpId: string; state?: "active" | "pending" | "retired"; userId?: string }) {
  const id = userId ?? (await addUser(db, "Ema")).id;
  await db.insert(credentials).values({
    id: passkey.credential.id,
    userId: id,
    publicKey: passkey.credential.publicKey,
    userHandle: toHex(crypto.getRandomValues(new Uint8Array(16))),
    rpId,
    state,
  });
  return id;
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

  it("keeps the passkey as the person's active one, for the site it was made on", async () => {
    const { passkey } = await register();
    const [row] = await db.select().from(credentials).where(eq(credentials.id, passkey.credential.id));
    expect(row).toMatchObject({ rpId: RP_ID, state: "active" });
  });

  it("takes the public key from the attestation, not from the browser", async () => {
    const passkey = createFakePasskey();
    const browsers = createFakePasskey().credential.publicKey; // what a page could say in its JSON
    const { result } = await register(passkey, { input: { publicKey: browsers } as Partial<Registration> });
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(credentials).where(eq(credentials.id, passkey.credential.id));
    expect(row?.publicKey).toBe(passkey.credential.publicKey);
    const [person] = await db.select().from(users).where(eq(users.id, result.ok ? result.userId : ""));
    expect(person?.account).toBe(await deriveAccount({ id: passkey.credential.id, publicKey: passkey.credential.publicKey }));
  });

  it("refuses an attestation for another site", async () => {
    const before = await countUsers();
    // Only the site differs: the ceremony's origin is the one the server expects.
    const old = createFakePasskey({ rpId: LEGACY_RP_ID });
    const refused = await register(old, { rpId: "tesoreria.finance" });
    expect(refused.result).toEqual({ ok: false, status: 400, error: es.auth.badPasskey });
    expect(refused.session.userId).toBeUndefined();
    expect(await db.select().from(credentials).where(eq(credentials.id, old.credential.id))).toEqual([]);
    expect(await countUsers()).toBe(before);
    // Control: a passkey made for the site the server registers for is kept, with that site.
    const made = createFakePasskey({ rpId: "tesoreria.finance" });
    expect((await register(made, { rpId: "tesoreria.finance" })).result.ok).toBe(true);
    const [row] = await db.select().from(credentials).where(eq(credentials.id, made.credential.id));
    expect(row).toMatchObject({ rpId: "tesoreria.finance", state: "active" });
  });

  it("refuses an attestation whose credential id differs from the input's", async () => {
    const before = await countUsers();
    const refused = await register(createFakePasskey(), { input: { credentialId: "another-credential" } });
    expect(refused.result).toEqual({ ok: false, status: 400, error: es.auth.badPasskey });
    expect(refused.session.userId).toBeUndefined();
    expect(await countUsers()).toBe(before);
  });

  it("refuses an attestation from an authenticator that didn't verify the person", async () => {
    const unverified = altered(createFakePasskey(), (authData) => Uint8Array.from(authData, (byte, i) => (i === FLAGS ? byte & ~0x04 : byte)));
    expect((await register(unverified)).result).toEqual({ ok: false, status: 400, error: es.auth.badPasskey });
  });

  it("refuses a registration without attestationObject with badPasskey", async () => {
    // What a page whose JavaScript predates the attestation sends: its key in `publicKey`, and nothing to read it from.
    const stale = { publicKey: createFakePasskey().credential.publicKey, attestationObject: undefined } as Partial<Registration>;
    const refused = await register(createFakePasskey(), { input: stale });
    expect(refused.result).toEqual({ ok: false, status: 400, error: es.auth.badPasskey });
    expect(refused.session.userId).toBeUndefined();
  });

  it("refuses an attestation object that isn't one, whatever it is", async () => {
    for (const attestationObject of ["0x", "0x1234", `0x${"ff".repeat(200)}`, "not hex"]) {
      const refused = await register(createFakePasskey(), { input: { attestationObject: attestationObject as Hex } });
      expect(refused.result, attestationObject).toEqual({ ok: false, status: 400, error: es.auth.badPasskey });
    }
  });

  it("refuses an old challenge, another ceremony, another origin, and a key whose account already exists", async () => {
    expect((await register(createFakePasskey(), { now: NOW + CHALLENGE_TTL_MS + 1 })).result).toMatchObject({ ok: false, status: 400 });
    expect((await register(createFakePasskey(), { type: "webauthn.get" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await register(createFakePasskey(), { origin: "https://evil.example" })).result).toMatchObject({ ok: false, status: 400 });
    const passkey = createFakePasskey();
    expect((await register(passkey)).result.ok).toBe(true);
    const again = await register(underAnotherId(passkey));
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
      userHandle: toHex(crypto.getRandomValues(new Uint8Array(16))),
      ...other.attest({ challenge: issueChallenge(fakeSession(), NOW) }),
    };
    expect(await registerMember({ db, session, input, deriveAccount, rpId: RP_ID, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a name, an email, an attestation or a user handle that doesn't fit", async () => {
    const bad = (input: Partial<Registration>) => register(createFakePasskey(), { input });
    expect((await bad({ name: "   " })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ name: "x".repeat(31) })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ email: "not-a-mail" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ attestationObject: "0x1234" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ userHandle: "0x1234" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ clientDataJSON: "not json" })).result).toMatchObject({ ok: false, status: 400 });
    expect((await bad({ email: " ema@example.com " })).result.ok).toBe(true);
  });

  it("refuses someone else's credential id without leaving a person behind", async () => {
    const mine = createFakePasskey();
    expect((await register(mine)).result.ok).toBe(true);
    const before = (await db.select().from(users)).length;
    const taken = await register(underAnotherId(createFakePasskey(), mine.credential.id));
    expect(taken.result).toMatchObject({ ok: false, status: 409 });
    expect(taken.session.userId).toBeUndefined();
    expect((await db.select().from(users)).length).toBe(before);
  });

  it("answers 409 only for a unique violation, wherever the race is lost", async () => {
    const mine = createFakePasskey();
    expect((await register(mine)).result.ok).toBe(true);
    const before = await countUsers();
    // The same account, past the lookups: the unique column refuses it.
    const sameKey = await register(underAnotherId(mine), { db: racing() });
    expect(sameKey.result).toMatchObject({ ok: false, status: 409 });
    // Another key under the registered credential id: the person goes in, the passkey is refused, the person comes out.
    const sameCredential = await register(underAnotherId(createFakePasskey(), mine.credential.id), { db: racing() });
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
    const first = await logIn({ db, session, assertion, origin: ORIGIN, now: NOW, m: es });
    expect(first).toEqual({ ok: true, userId: result.ok ? result.userId : "" });
    expect(session.userId).toBe(result.ok ? result.userId : undefined);
    // The same assertion again: the challenge it answered is gone, and a new one is not what it signed.
    expect(await logIn({ db, session, assertion, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 400 });
    const replay = fakeSession();
    issueChallenge(replay, NOW);
    expect(await logIn({ db, session: replay, assertion, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 401 });
    expect(replay.userId).toBeUndefined();
  });

  it("keeps out another origin, an unknown passkey and a late answer", async () => {
    const { passkey } = await register();
    const attempt = async (getFn = passkey.getFn, { origin = ORIGIN, late = 0 } = {}) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn });
      const result = await logIn({ db, session, assertion, origin, now: NOW + late, m: es });
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
      return logIn({ db, session, assertion, origin: ORIGIN, now: NOW + late, m: es });
    };
    expect((await attempt(CHALLENGE_TTL_MS)).ok).toBe(true);
    expect((await attempt(CHALLENGE_TTL_MS + 1)).ok).toBe(false);
  });

  it("burns the challenge when the answer is wrong, so a right answer can't follow it", async () => {
    const { passkey } = await register();
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
    const wrongOrigin = await logIn({ db, session, assertion, origin: "https://evil.example", now: NOW, m: es });
    expect(wrongOrigin).toMatchObject({ ok: false, status: 401 });
    expect(session.challenge).toBeUndefined();
    expect(await logIn({ db, session, assertion, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 400 });
    expect(session.userId).toBeUndefined();
  });

  it("answers 401, never an exception, to a malformed assertion", async () => {
    const { passkey } = await register();
    const attempt = async (change: Partial<Awaited<ReturnType<typeof signPasskeyChallenge>>>) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
      const result = await logIn({ db, session, assertion: { ...assertion, ...change }, origin: ORIGIN, now: NOW, m: es });
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
    expect(await logIn({ db, session: fakeSession(), assertion, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 400 });
  });

  it("keeps out another passkey that claims to be a member's", async () => {
    const { passkey } = await register();
    const session = fakeSession();
    const signed = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: createFakePasskey().getFn });
    const assertion = { ...signed, credentialId: passkey.credential.id };
    expect(await logIn({ db, session, assertion, origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 401 });
    expect(session.userId).toBeUndefined();
  });

  it("checks each login against the site its passkey was made for", async () => {
    const attempt = async (passkey: FakePasskey, signedFor = RP_ID) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: signedFor, getFn: passkey.getFn });
      const result = await logIn({ db, session, assertion, origin: ORIGIN, now: NOW, m: es });
      return { result, session };
    };
    // The authenticator signs for the site it made the passkey for; the row says the passkey belongs to another one.
    const member = (await register()).passkey;
    await db.update(credentials).set({ rpId: "tesoreria.example" }).where(eq(credentials.id, member.credential.id));
    const wrongSite = await attempt(member);
    expect(wrongSite.result).toMatchObject({ ok: false, status: 401 });
    expect(wrongSite.session.userId).toBeUndefined();
    // Control: the row and the authenticator agree, and the server's own RP_ID has nothing to do with it.
    const foreign = createFakePasskey({ rpId: "tesoreria.example" });
    await addPasskey(foreign, { rpId: "tesoreria.example" });
    expect((await attempt(foreign, "tesoreria.example")).result.ok).toBe(true);
  });

  it("logs in with an old-site passkey from the new origin", async () => {
    const origin = "https://tesoreria.finance";
    const old = createFakePasskey({ rpId: LEGACY_RP_ID, origin });
    const userId = await addPasskey(old, { rpId: LEGACY_RP_ID });
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: LEGACY_RP_ID, getFn: old.getFn });
    expect(await logIn({ db, session, assertion, origin, now: NOW, m: es })).toEqual({ ok: true, userId });
    expect(session.userId).toBe(userId);
  });

  it("refuses a retired passkey", async () => {
    const retired = createFakePasskey();
    const userId = await addPasskey(retired, { rpId: RP_ID, state: "retired" });
    await addPasskey(createFakePasskey(), { rpId: RP_ID, userId });
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: retired.getFn });
    expect(await logIn({ db, session, assertion, origin: ORIGIN, now: NOW, m: es })).toEqual({ ok: false, status: 401, error: es.auth.unknownPasskey });
    expect(session.userId).toBeUndefined();
    expect(session.challenge).toBeUndefined();
  });

  it("logs in with a pending passkey, as the same person", async () => {
    const pending = createFakePasskey();
    const userId = await addPasskey(createFakePasskey({ rpId: LEGACY_RP_ID }), { rpId: LEGACY_RP_ID });
    await addPasskey(pending, { rpId: RP_ID, state: "pending", userId });
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: pending.getFn });
    expect(await logIn({ db, session, assertion, origin: ORIGIN, now: NOW, m: es })).toEqual({ ok: true, userId });
    expect(session.userId).toBe(userId);
  });

  it("refuses a passkey in a state it doesn't know", async () => {
    // The column is plain text in Postgres: a state the code doesn't name keeps the passkey out.
    const unknown = createFakePasskey();
    await addPasskey(unknown, { rpId: RP_ID });
    await db.execute(sql`update ${credentials} set state = 'lost' where id = ${unknown.credential.id}`);
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: unknown.getFn });
    expect(await logIn({ db, session, assertion, origin: ORIGIN, now: NOW, m: es })).toEqual({ ok: false, status: 401, error: es.auth.unknownPasskey });
    expect(session.userId).toBeUndefined();
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
    const same = () => underAnotherId(createFakePasskey(), mine.credential.id);
    expect((await register(same())).result).toEqual({ ok: false, status: 409, error: "Esa passkey ya tiene una cuenta. Entrá con ella." });
    expect((await register(same(), { m: en })).result).toEqual({ ok: false, status: 409, error: en.auth.taken });
  });

  it("says why a login was refused, in Spanish and in English", async () => {
    const attempt = async (m: Messages, late = 0) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: createFakePasskey().getFn });
      return logIn({ db, session, assertion, origin: ORIGIN, now: NOW + late, m });
    };
    expect(await attempt(es)).toEqual({ ok: false, status: 401, error: "No pudimos reconocer tu passkey." });
    expect(await attempt(en)).toEqual({ ok: false, status: 401, error: en.auth.unknownPasskey });
    expect(await attempt(en, CHALLENGE_TTL_MS + 1)).toEqual({ ok: false, status: 400, error: en.auth.late });
  });
});
