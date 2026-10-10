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
import { users } from "../src/lib/db/schema";
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
  change: { origin?: string; type?: string; now?: number; input?: Partial<Registration> } = {},
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
  const result = await registerMember({ db, session, input, deriveAccount, origin: ORIGIN, now: change.now ?? NOW });
  return { result, session, passkey };
}

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
    expect(await registerMember({ db, session, input, deriveAccount, origin: ORIGIN, now: NOW })).toMatchObject({ ok: false, status: 400 });
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
});

describe("logIn", () => {
  it("lets a member in with their passkey, once per challenge", async () => {
    const { result, passkey } = await register();
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
    const first = await logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW });
    expect(first).toEqual({ ok: true, userId: result.ok ? result.userId : "" });
    expect(session.userId).toBe(result.ok ? result.userId : undefined);
    // The same assertion again: the challenge it answered is gone, and a new one is not what it signed.
    expect(await logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW })).toMatchObject({ ok: false, status: 400 });
    const replay = fakeSession();
    issueChallenge(replay, NOW);
    expect(await logIn({ db, session: replay, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW })).toMatchObject({ ok: false, status: 401 });
    expect(replay.userId).toBeUndefined();
  });

  it("keeps out another origin, an unknown passkey and a late answer", async () => {
    const { passkey } = await register();
    const attempt = async (getFn = passkey.getFn, { origin = ORIGIN, late = 0 } = {}) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn });
      const result = await logIn({ db, session, assertion, rpId: RP_ID, origin, now: NOW + late });
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
      return logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW + late });
    };
    expect((await attempt(CHALLENGE_TTL_MS)).ok).toBe(true);
    expect((await attempt(CHALLENGE_TTL_MS + 1)).ok).toBe(false);
  });

  it("burns the challenge when the answer is wrong, so a right answer can't follow it", async () => {
    const { passkey } = await register();
    const session = fakeSession();
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
    const wrongOrigin = await logIn({ db, session, assertion, rpId: RP_ID, origin: "https://evil.example", now: NOW });
    expect(wrongOrigin).toMatchObject({ ok: false, status: 401 });
    expect(session.challenge).toBeUndefined();
    expect(await logIn({ db, session, assertion, rpId: RP_ID, origin: ORIGIN, now: NOW })).toMatchObject({ ok: false, status: 400 });
    expect(session.userId).toBeUndefined();
  });

  it("answers 401, never an exception, to a malformed assertion", async () => {
    const { passkey } = await register();
    const attempt = async (change: Partial<Awaited<ReturnType<typeof signPasskeyChallenge>>>) => {
      const session = fakeSession();
      const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session, NOW), rpId: RP_ID, getFn: passkey.getFn });
      const result = await logIn({ db, session, assertion: { ...assertion, ...change }, rpId: RP_ID, origin: ORIGIN, now: NOW });
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
    expect(await logIn({ db, session: fakeSession(), assertion, rpId: RP_ID, origin: ORIGIN, now: NOW })).toMatchObject({ ok: false, status: 400 });
  });
});
