import { type SafeKey, safeKeyOf, signPasskeyChallenge } from "@tesoreria/wallet";
import { type FakePasskey, createFakePasskey } from "@tesoreria/wallet/testing";
import { eq } from "drizzle-orm";
import { type Address, getAddress, toHex } from "viem";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CHALLENGE_TTL_MS, issueChallenge, logIn } from "../src/lib/auth";
import type { Db } from "../src/lib/db/client";
import { credentials, operations } from "../src/lib/db/schema";
import { es } from "../src/lib/i18n/es";
import { type KeyChangeInput, confirmKeyChange, keyChangeKeyFor, keyChangeOf, proveKeyChange, startKeyChange } from "../src/lib/key-change";
import { LEGACY_RP_ID } from "../src/lib/passkey-sites";
import type { Session } from "../src/lib/session";
import { addUser, testDb } from "./support/db";
import { fakeSession } from "./support/session";

const RP_ID = "tesoreria.finance";
const ORIGIN = "https://tesoreria.finance";
const NOW = 1_791_640_000_000;

// /api/me and the key routes as the server runs them, with the session, the database, the settings and the chain standing in.
const state = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  readSafeKey: null as unknown as (account: Address) => Promise<SafeKey>,
  pilot: undefined as Address | undefined,
}));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/session", () => ({ getSession: async () => state.session }));
vi.mock("../src/lib/env", () => ({
  env: () => ({ RP_ID: "tesoreria.finance", ORIGIN: "https://tesoreria.finance", KEY_CHANGE_PILOT: state.pilot }),
}));
vi.mock("../src/lib/chain", () => ({ celoClient: () => "celo" }));
vi.mock("@tesoreria/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tesoreria/wallet")>()),
  readSafeKey: async (client: unknown, account: Address) => {
    if (client !== "celo") throw new Error("not the Celo client");
    return state.readSafeKey(account);
  },
}));

const meRoute = await import("../src/app/api/me/route");
const startRoute = await import("../src/app/api/auth/key/route");
const proveRoute = await import("../src/app/api/auth/key/prove/route");
const confirmRoute = await import("../src/app/api/auth/key/confirm/route");

// Every test makes its own people, so they can share one database.
let db: Db;
beforeAll(async () => {
  db = await testDb();
  state.db = db;
});

type Person = { id: string; name: string; account: Address };

const userHandle = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

/** A passkey of the new site, used from it. */
const newPasskey = () => createFakePasskey({ rpId: RP_ID, origin: ORIGIN });

/** Someone whose active passkey belongs to `rpId`: by default the old site, as everyone's did before the move. */
async function member(rpId = LEGACY_RP_ID) {
  const passkey = createFakePasskey({ rpId, origin: ORIGIN });
  const row = await addUser(db, "Ema");
  await db
    .insert(credentials)
    .values({ id: passkey.credential.id, userId: row.id, publicKey: passkey.credential.publicKey, userHandle: userHandle(), rpId });
  const user: Person = { id: row.id, name: row.name, account: getAddress(row.account) };
  return { user, passkey };
}

/** A session of `user`'s, as after they logged in. */
function sessionOf(user: Person) {
  const session = fakeSession();
  session.userId = user.id;
  return session;
}

/** The chain, as `confirmKeyChange` and `startKeyChange` read it: the Safe holds this passkey's key. */
const holding = (passkey: FakePasskey) => async (): Promise<SafeKey> => safeKeyOf(passkey.credential.publicKey);
/** A Safe that isn't deployed yet reads as all zeros. */
const undeployed = async (): Promise<SafeKey> => ({ x: 0n, y: 0n, verifiers: 0n });
/** For a call that must not read the chain. */
const unread = async (): Promise<SafeKey> => {
  throw new Error("read the chain");
};

/**
 * The page's first step: it makes `passkey` on the session's challenge and posts what the authenticator answered.
 * The chain is read only to replace a pending passkey; by default, reading it fails, as forno would. `site` is the
 * server's: by default tesoreria.finance, with no pilot.
 */
async function start(
  user: Person,
  {
    passkey = newPasskey(),
    session = sessionOf(user),
    attest = {},
    now = NOW,
    readKey = unread,
    site = { rpId: RP_ID, origin: ORIGIN },
  }: {
    passkey?: FakePasskey;
    session?: ReturnType<typeof fakeSession>;
    attest?: { rpId?: string; origin?: string };
    now?: number;
    readKey?: (account: Address) => Promise<SafeKey>;
    site?: { rpId: string; origin: string; pilot?: Address };
  } = {},
) {
  const challenge = issueChallenge(session, NOW);
  const input: KeyChangeInput = { credentialId: passkey.credential.id, userHandle: userHandle(), ...passkey.attest({ challenge, ...attest }) };
  const result = await startKeyChange({ db, session, user, input, ...site, now, readKey, m: es });
  return { result, session, passkey };
}

/** The passkey's row, as the database has it now. */
const rowOf = async (passkey: FakePasskey) => (await db.select().from(credentials).where(eq(credentials.id, passkey.credential.id)))[0];

/** The passkey's answer to a fresh challenge of the session's, for the site it was made for. */
const signed = (passkey: FakePasskey, session: Session, rpId = RP_ID, now = NOW) =>
  signPasskeyChallenge({ challenge: issueChallenge(session, now), rpId, getFn: passkey.getFn });

/** A key change of the person's, as the page records it once the bundler takes it: `success` stays null until its receipt. */
async function sent(user: Person, success: boolean | null = null) {
  await db.insert(operations).values({ userOpHash: toHex(crypto.getRandomValues(new Uint8Array(32))), userId: user.id, kind: "key-change", success });
}

describe("keyChangeOf", () => {
  it("is due for an old-site passkey, and not for a new one", async () => {
    const old = await member();
    expect(await keyChangeOf(db, old.user, sessionOf(old.user), { rpId: RP_ID })).toEqual({ due: true, pending: null, ready: false, onItsWay: false });
    // Nor while the site is still the old one: there would be nothing to change to.
    expect((await keyChangeOf(db, old.user, sessionOf(old.user), { rpId: LEGACY_RP_ID })).due).toBe(false);
    const fresh = await member(RP_ID);
    expect(await keyChangeOf(db, fresh.user, sessionOf(fresh.user), { rpId: RP_ID })).toEqual({ due: false, pending: null, ready: false, onItsWay: false });
  });

  it("is due only for the pilot while KEY_CHANGE_PILOT is set", async () => {
    const pilot = await member();
    const friend = await member();
    const settings = { rpId: RP_ID, pilot: pilot.user.account };
    expect((await keyChangeOf(db, pilot.user, sessionOf(pilot.user), settings)).due).toBe(true);
    // A friend who logs in during the pilot sees no request, and signs with their old-site passkey (Review Focus 1).
    expect((await keyChangeOf(db, friend.user, sessionOf(friend.user), settings)).due).toBe(false);
    // Without the variable, everyone with an old-site passkey is asked.
    expect((await keyChangeOf(db, friend.user, sessionOf(friend.user), { rpId: RP_ID })).due).toBe(true);
  });
});

describe("startKeyChange", () => {
  it("starts a key change: the new passkey is pending and this session is ready", async () => {
    const { user, passkey: old } = await member();
    const { result, session, passkey } = await start(user);
    expect(result).toEqual({ ok: true, publicKey: passkey.credential.publicKey });
    // The same person, with the key its attestation gives; the old passkey is still the one the Safe holds.
    expect(await rowOf(passkey)).toMatchObject({ userId: user.id, publicKey: passkey.credential.publicKey, rpId: RP_ID, state: "pending" });
    expect(await rowOf(old)).toMatchObject({ state: "active" });
    expect(session.keyChange).toBe(passkey.credential.id);
    expect(session.challenge).toBeUndefined();
    expect(session.saved).toBeGreaterThan(0);
    const pending = { id: passkey.credential.id, rpId: RP_ID, publicKey: passkey.credential.publicKey };
    expect(await keyChangeOf(db, user, session, { rpId: RP_ID })).toEqual({ due: true, pending, ready: true, onItsWay: false });
    expect(await keyChangeKeyFor(db, user, session)).toBe(passkey.credential.publicKey);
    // Another session of the same person neither made it nor proved it.
    const other = sessionOf(user);
    expect(await keyChangeOf(db, user, other, { rpId: RP_ID })).toEqual({ due: true, pending, ready: false, onItsWay: false });
    expect(await keyChangeKeyFor(db, user, other)).toBeNull();
  });

  it("refuses to start without an old-site active passkey", async () => {
    const { user } = await member(RP_ID);
    const { result, session, passkey } = await start(user);
    expect(result).toEqual({ ok: false, status: 409, error: es.errors.generic });
    expect(await rowOf(passkey)).toBeUndefined();
    expect(session.keyChange).toBeUndefined();
    expect(session.challenge).toBeUndefined();
  });

  it("refuses to start a key change while the site is still the old one", async () => {
    // Every account has an old-site passkey there, so a second one of that site would make any of them ready.
    const { user } = await member();
    const oldSite = { rpId: LEGACY_RP_ID, origin: `https://${LEGACY_RP_ID}` };
    const { result, session, passkey } = await start(user, { passkey: createFakePasskey(oldSite), site: oldSite });
    expect(result).toEqual({ ok: false, status: 409, error: es.errors.generic });
    expect(await rowOf(passkey)).toBeUndefined();
    expect(session.keyChange).toBeUndefined();
    expect(session.challenge).toBeUndefined();
  });

  it("refuses to start a key change for someone outside the pilot", async () => {
    const pilot = await member();
    const friend = await member();
    const site = { rpId: RP_ID, origin: ORIGIN, pilot: pilot.user.account };
    const refused = await start(friend.user, { site });
    expect(refused.result).toEqual({ ok: false, status: 409, error: es.errors.generic });
    expect(await rowOf(refused.passkey)).toBeUndefined();
    expect(refused.session.keyChange).toBeUndefined();
    const started = await start(pilot.user, { site });
    expect(started.result).toEqual({ ok: true, publicKey: started.passkey.credential.publicKey });
  });

  it("checks the new passkey as a registration does", async () => {
    const { user } = await member();
    const forTheOldSite = await start(user, { passkey: createFakePasskey({ rpId: LEGACY_RP_ID, origin: ORIGIN }) });
    expect(forTheOldSite.result).toEqual({ ok: false, status: 400, error: es.auth.badPasskey });
    const elsewhere = await start(user, { attest: { origin: "https://evil.example" } });
    expect(elsewhere.result).toEqual({ ok: false, status: 400, error: es.auth.badPasskey });
    const late = await start(user, { now: NOW + CHALLENGE_TTL_MS + 1 });
    expect(late.result).toEqual({ ok: false, status: 400, error: es.auth.late });
    for (const { session, passkey } of [forTheOldSite, elsewhere, late]) {
      expect(await rowOf(passkey)).toBeUndefined();
      expect(session.keyChange).toBeUndefined();
      expect(session.challenge).toBeUndefined();
    }
  });
});

describe("keyChangeKeyFor", () => {
  it("keyChangeKeyFor ignores a pending passkey of the old site", async () => {
    // However it got there: no start keeps one, so the gate never sponsors a key change toward the old site.
    const { user } = await member();
    const oldSite = createFakePasskey({ rpId: LEGACY_RP_ID, origin: ORIGIN });
    await db.insert(credentials).values({
      id: oldSite.credential.id,
      userId: user.id,
      publicKey: oldSite.credential.publicKey,
      userHandle: userHandle(),
      rpId: LEGACY_RP_ID,
      state: "pending",
    });
    const session = sessionOf(user);
    session.keyChange = oldSite.credential.id;
    expect(await keyChangeKeyFor(db, user, session)).toBeNull();
    // The same row for the new site is the key change's.
    await db.update(credentials).set({ rpId: RP_ID }).where(eq(credentials.id, oldSite.credential.id));
    expect(await keyChangeKeyFor(db, user, session)).toBe(oldSite.credential.publicKey);
  });
});

describe("a key change on its way", () => {
  it("refuses a new pending passkey while a key change is on its way", async () => {
    const { user, passkey: old } = await member();
    const first = await start(user);
    await sent(user);
    expect((await keyChangeOf(db, user, first.session, { rpId: RP_ID })).onItsWay).toBe(true);
    // A second tap, or a second tab of the same browser (Review Focus 3). The chain doesn't have it yet.
    const second = await start(user, { session: first.session, readKey: holding(old) });
    expect(second.result).toEqual({ ok: false, status: 409, error: es.errors.onItsWay });
    expect(await rowOf(first.passkey)).toMatchObject({ state: "pending" });
    expect(await rowOf(second.passkey)).toBeUndefined();
    expect(first.session.keyChange).toBe(first.passkey.credential.id);
    // Landed, with a node behind still showing the old key: the Safe may hold the pending key, so it isn't replaced either.
    await db.update(operations).set({ success: true }).where(eq(operations.userId, user.id));
    expect((await start(user, { readKey: holding(old) })).result).toEqual({ ok: false, status: 409, error: es.errors.onItsWay });
    expect(await rowOf(first.passkey)).toMatchObject({ state: "pending" });
    expect((await keyChangeOf(db, user, first.session, { rpId: RP_ID })).onItsWay).toBe(true);
  });

  it("doesn't replace a pending passkey when the Safe already holds its key", async () => {
    // The change landed, its record was lost, and nothing confirmed it: only the chain knows.
    const { user, passkey: old } = await member();
    const first = await start(user);
    const second = await start(user, { readKey: holding(first.passkey) });
    // It's confirmed instead, and the start is refused: no old-site passkey is left to change.
    expect(second.result).toEqual({ ok: false, status: 409, error: es.errors.generic });
    expect(await rowOf(first.passkey)).toMatchObject({ state: "active" });
    expect(await rowOf(old)).toMatchObject({ state: "retired" });
    expect(await rowOf(second.passkey)).toBeUndefined();
    expect(second.session.keyChange).toBeUndefined();
    expect(await keyChangeOf(db, user, second.session, { rpId: RP_ID })).toEqual({ due: false, pending: null, ready: false, onItsWay: false });
  });

  it("doesn't replace a pending passkey when the chain can't be read", async () => {
    const { user, passkey: old } = await member();
    const first = await start(user);
    const second = await start(user); // the default reader fails
    expect(second.result).toEqual({ ok: false, status: 503, error: es.errors.generic });
    expect(await rowOf(first.passkey)).toMatchObject({ state: "pending" });
    expect(await rowOf(old)).toMatchObject({ state: "active" });
    expect(await rowOf(second.passkey)).toBeUndefined();
    expect(second.session.keyChange).toBeUndefined();
    expect(second.session.challenge).toBeUndefined();
  });

  it("doesn't replace a pending passkey when its key change is recorded while the chain is read", async () => {
    // The read shows the old key, and the change is recorded before the delete (by the page's onSent, or by the server
    // when the bundler takes it): the delete checks for it itself, so it removes nothing.
    const { user, passkey: old } = await member();
    const first = await start(user);
    const readKey = async () => {
      const key = await holding(old)();
      await sent(user);
      return key;
    };
    const second = await start(user, { readKey });
    expect(second.result).toEqual({ ok: false, status: 409, error: es.errors.onItsWay });
    expect(await rowOf(first.passkey)).toMatchObject({ state: "pending" });
    expect(await rowOf(second.passkey)).toBeUndefined();
  });

  it("keeps one pending passkey when two starts race", async () => {
    const { user } = await member();
    // Both read that nothing is pending before either keeps its passkey: the second insert meets the first.
    const results = (await Promise.all([start(user), start(user)])).map(({ result }) => result);
    expect(results).toContainEqual({ ok: false, status: 409, error: es.errors.onItsWay });
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect((await keyChangeOf(db, user, sessionOf(user), { rpId: RP_ID })).pending).not.toBeNull();
  });

  it("replaces a pending passkey when no key change is on its way", async () => {
    const { user, passkey: old } = await member();
    const first = await start(user);
    await sent(user, false); // one that failed changed nothing
    await sent((await member()).user); // and someone else's is theirs
    // Another phone, without the pending passkey: it can't prove it, so it makes a new one (Review Focus 4). The
    // chain shows the Safe still holds the old key.
    const second = await start(user, { readKey: holding(old) });
    expect(second.result).toEqual({ ok: true, publicKey: second.passkey.credential.publicKey });
    expect(await rowOf(first.passkey)).toBeUndefined();
    expect(await rowOf(second.passkey)).toMatchObject({ userId: user.id, state: "pending" });
    expect(second.session.keyChange).toBe(second.passkey.credential.id);
    expect((await keyChangeOf(db, user, second.session, { rpId: RP_ID })).onItsWay).toBe(false);
    // The first session's passkey is gone: no key change it asks for is sponsored.
    expect((await keyChangeOf(db, user, first.session, { rpId: RP_ID })).ready).toBe(false);
    expect(await keyChangeKeyFor(db, user, first.session)).toBeNull();
  });
});

describe("proveKeyChange", () => {
  it("proves a pending passkey in a later session", async () => {
    const { user } = await member();
    const { passkey } = await start(user);
    const later = sessionOf(user);
    const assertion = await signed(passkey, later);
    expect(await proveKeyChange({ db, session: later, user, assertion, origin: ORIGIN, now: NOW, m: es })).toEqual({ ok: true, userId: user.id });
    expect(later.keyChange).toBe(passkey.credential.id);
    expect(later.challenge).toBeUndefined();
    expect(await keyChangeKeyFor(db, user, later)).toBe(passkey.credential.publicKey);
  });

  it("refuses a proof signed by another passkey", async () => {
    const { user, passkey: old } = await member();
    const { passkey } = await start(user);
    const someoneElses = (await start((await member()).user)).passkey;
    const later = sessionOf(user);
    // Each answers the session's own challenge: what's wrong with it is only who signed it.
    const proofs = [
      () => signed(old, later, LEGACY_RP_ID), // the active one: it can't stand for the new one
      async () => ({ ...(await signed(newPasskey(), later)), credentialId: passkey.credential.id }), // a stranger under the pending one's id
      () => signed(someoneElses, later), // another person's pending passkey
    ];
    for (const proof of proofs) {
      const assertion = await proof();
      const refused = await proveKeyChange({ db, session: later, user, assertion, origin: ORIGIN, now: NOW, m: es });
      expect(refused).toEqual({ ok: false, status: 401, error: es.auth.unknownPasskey });
      expect(later.challenge).toBeUndefined();
    }
    expect(later.keyChange).toBeUndefined();
    expect(await keyChangeKeyFor(db, user, later)).toBeNull();
  });
});

describe("logIn", () => {
  it("logging in with the pending passkey makes this session ready", async () => {
    const { user, passkey: old } = await member();
    const { passkey } = await start(user);
    const withTheOld = fakeSession();
    expect(await logIn({ db, session: withTheOld, assertion: await signed(old, withTheOld, LEGACY_RP_ID), origin: ORIGIN, now: NOW, m: es })).toEqual({ ok: true, userId: user.id });
    expect(withTheOld.keyChange).toBeUndefined();
    const withTheNew = fakeSession();
    expect(await logIn({ db, session: withTheNew, assertion: await signed(passkey, withTheNew), origin: ORIGIN, now: NOW, m: es })).toEqual({ ok: true, userId: user.id });
    expect(withTheNew.keyChange).toBe(passkey.credential.id);
    expect((await keyChangeOf(db, user, withTheNew, { rpId: RP_ID })).ready).toBe(true);
    expect(await keyChangeKeyFor(db, user, withTheNew)).toBe(passkey.credential.publicKey);
  });
});

describe("confirmKeyChange", () => {
  it("confirms only when the Safe's key is the pending one", async () => {
    const { user, passkey: old } = await member();
    expect(await confirmKeyChange(db, user, unread)).toBe("none"); // nothing pending: the chain isn't read
    const { passkey } = await start(user);
    expect(await confirmKeyChange(db, user, holding(old))).toBe("waiting");
    expect(await confirmKeyChange(db, user, undeployed)).toBe("waiting");
    expect(await rowOf(old)).toMatchObject({ state: "active" });
    expect(await rowOf(passkey)).toMatchObject({ state: "pending" });
    const readKey = vi.fn(holding(passkey));
    expect(await confirmKeyChange(db, user, readKey)).toBe("changed");
    expect(readKey).toHaveBeenCalledWith(user.account);
    expect(await rowOf(old)).toMatchObject({ state: "retired" });
    expect(await rowOf(passkey)).toMatchObject({ state: "active" });
    expect(await confirmKeyChange(db, user, unread)).toBe("none");
    expect(await keyChangeOf(db, user, sessionOf(user), { rpId: RP_ID })).toEqual({ due: false, pending: null, ready: false, onItsWay: false });
    // The old passkey no longer gets in.
    const session = fakeSession();
    expect(await logIn({ db, session, assertion: await signed(old, session, LEGACY_RP_ID), origin: ORIGIN, now: NOW, m: es })).toMatchObject({ ok: false, status: 401 });
  });

  it("finishes a confirmation cut between its two updates", async () => {
    const { user, passkey: old } = await member();
    const { passkey } = await start(user);
    // The first update went through and the call ended before the second: a pending passkey, and no active one.
    await db.update(credentials).set({ state: "retired" }).where(eq(credentials.id, old.credential.id));
    // Finished only once the chain shows the pending key, as any confirmation.
    expect(await confirmKeyChange(db, user, holding(old))).toBe("waiting");
    expect(await rowOf(passkey)).toMatchObject({ state: "pending" });
    expect(await confirmKeyChange(db, user, holding(passkey))).toBe("changed");
    expect(await rowOf(passkey)).toMatchObject({ state: "active" });
    expect(await rowOf(old)).toMatchObject({ state: "retired" });
  });

  it("says changed to two confirmations at once", async () => {
    // /api/me and the page's own confirmation, say: one makes the change, and the other finds it made.
    const { user, passkey: old } = await member();
    const { passkey } = await start(user);
    expect(await Promise.all([confirmKeyChange(db, user, holding(passkey)), confirmKeyChange(db, user, holding(passkey))])).toEqual(["changed", "changed"]);
    expect(await rowOf(passkey)).toMatchObject({ state: "active" });
    expect(await rowOf(old)).toMatchObject({ state: "retired" });
  });

  it("retires nothing when the pending passkey goes while the chain is read", async () => {
    const { user, passkey: old } = await member();
    const { passkey } = await start(user);
    const readKey = async () => {
      await db.delete(credentials).where(eq(credentials.id, passkey.credential.id)); // a concurrent delete
      return safeKeyOf(passkey.credential.publicKey);
    };
    expect(await confirmKeyChange(db, user, readKey)).toBe("none");
    expect(await rowOf(old)).toMatchObject({ state: "active" });
  });
});

describe("GET /api/me", () => {
  const me = async () => {
    const answer = await meRoute.GET(new Request(`${ORIGIN}/api/me`));
    expect(answer.status).toBe(200);
    return answer.json();
  };

  it("confirms lazily from /api/me", async () => {
    const { user, passkey: old } = await member();
    const { passkey } = await start(user);
    await sent(user);
    // The page closed before confirming, and the member comes back in another session (Review Focus 2).
    state.session = sessionOf(user);
    const reads: Address[] = [];
    const chainHolding = (holder: FakePasskey) => async (account: Address) => {
      reads.push(account);
      return safeKeyOf(holder.credential.publicKey);
    };
    state.readSafeKey = chainHolding(old);
    const pending = { id: passkey.credential.id, rpId: RP_ID, publicKey: passkey.credential.publicKey };
    expect(await me()).toEqual({
      name: "Ema",
      account: user.account,
      credential: { id: old.credential.id, publicKey: old.credential.publicKey, rpId: LEGACY_RP_ID },
      keyChange: { due: true, pending, ready: false, onItsWay: true },
    });
    // The chain has the new key now: /api/me confirms it before it answers, and answers with the new passkey.
    state.readSafeKey = chainHolding(passkey);
    expect(await me()).toEqual({
      name: "Ema",
      account: user.account,
      credential: { id: passkey.credential.id, publicKey: passkey.credential.publicKey, rpId: RP_ID },
      // Its operation never got a receipt, but with nothing pending nothing is on its way.
      keyChange: { due: false, pending: null, ready: false, onItsWay: false },
    });
    expect(await rowOf(old)).toMatchObject({ state: "retired" });
    // With nothing pending, it doesn't read the chain.
    await me();
    expect(reads).toEqual([user.account, user.account]);
  });

  it("answers as the database stands when the key change can't be confirmed", async () => {
    const { user, passkey: old } = await member();
    const { passkey } = await start(user);
    state.session = sessionOf(user);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const asItStands = { id: old.credential.id, publicKey: old.credential.publicKey, rpId: LEGACY_RP_ID };
    state.readSafeKey = async () => {
      throw new Error("forno is down");
    };
    expect((await me()).credential).toEqual(asItStands);
    // A pending key that isn't 64 bytes can't be compared: nothing is confirmed either.
    state.readSafeKey = holding(passkey);
    await db.update(credentials).set({ publicKey: "0x1234" }).where(eq(credentials.id, passkey.credential.id));
    expect((await me()).credential).toEqual(asItStands);
    expect(await rowOf(passkey)).toMatchObject({ state: "pending" });
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

describe("the key routes", () => {
  const post = (route: { POST: (request: Request) => Promise<Response> }, path: string, body: unknown) =>
    route.POST(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("answer 401 without a session", async () => {
    state.session = fakeSession();
    for (const [route, path] of [
      [startRoute, "/api/auth/key"],
      [proveRoute, "/api/auth/key/prove"],
      [confirmRoute, "/api/auth/key/confirm"],
    ] as const) {
      const answer = await post(route, path, {});
      expect(answer.status, path).toBe(401);
      expect(await answer.json()).toEqual({ error: es.errors.logIn });
    }
  });

  it("start, prove and confirm a key change, for the site and origin of the settings", async () => {
    const { user, passkey: old } = await member();
    const session = sessionOf(user);
    state.session = session;
    const passkey = newPasskey();
    const started = await post(startRoute, "/api/auth/key", {
      credentialId: passkey.credential.id,
      userHandle: userHandle(),
      ...passkey.attest({ challenge: issueChallenge(session) }),
    });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ publicKey: passkey.credential.publicKey });
    // Unlike a registration's, the request is malformed without its attestation.
    const stale = await post(startRoute, "/api/auth/key", { credentialId: passkey.credential.id, userHandle: userHandle(), clientDataJSON: "{}" });
    expect(stale.status).toBe(400);
    const later = sessionOf(user);
    state.session = later;
    const proved = await post(proveRoute, "/api/auth/key/prove", await signed(passkey, later, RP_ID, Date.now()));
    expect(proved.status).toBe(200);
    expect(later.keyChange).toBe(passkey.credential.id);
    state.readSafeKey = holding(old);
    expect(await (await post(confirmRoute, "/api/auth/key/confirm", {})).json()).toEqual({ result: "waiting" });
    state.readSafeKey = holding(passkey);
    expect(await (await post(confirmRoute, "/api/auth/key/confirm", {})).json()).toEqual({ result: "changed" });
  });

  it("start a key change only for the pilot while KEY_CHANGE_PILOT is set", async () => {
    const pilot = await member();
    const friend = await member();
    state.pilot = pilot.user.account;
    try {
      for (const [{ user }, status] of [
        [friend, 409],
        [pilot, 200],
      ] as const) {
        const session = sessionOf(user);
        state.session = session;
        const passkey = newPasskey();
        const answer = await post(startRoute, "/api/auth/key", { credentialId: passkey.credential.id, userHandle: userHandle(), ...passkey.attest({ challenge: issueChallenge(session) }) });
        expect(answer.status, user.account).toBe(status);
      }
    } finally {
      state.pilot = undefined;
    }
  });

  it("replace a pending passkey only once the chain shows the Safe doesn't hold its key", async () => {
    const { user, passkey: old } = await member();
    const session = sessionOf(user);
    state.session = session;
    const startWith = (passkey: FakePasskey) =>
      post(startRoute, "/api/auth/key", { credentialId: passkey.credential.id, userHandle: userHandle(), ...passkey.attest({ challenge: issueChallenge(session) }) });
    const first = newPasskey();
    expect((await startWith(first)).status).toBe(200);
    const second = newPasskey();
    state.readSafeKey = async () => {
      throw new Error("forno is down");
    };
    const refused = await startWith(second);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: es.errors.generic });
    state.readSafeKey = holding(old);
    expect((await startWith(second)).status).toBe(200);
    expect(await rowOf(first)).toBeUndefined();
    expect(await rowOf(second)).toMatchObject({ state: "pending" });
  });
});
