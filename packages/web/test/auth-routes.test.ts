import { signPasskeyChallenge } from "@tesoreria/wallet";
import { createFakePasskey } from "@tesoreria/wallet/testing";
import { eq } from "drizzle-orm";
import { type Hex, getAddress, keccak256, slice, toHex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueChallenge } from "../src/lib/auth";
import type { Db } from "../src/lib/db/client";
import { credentials, users } from "../src/lib/db/schema";
import { es } from "../src/lib/i18n/es";
import { LEGACY_RP_ID } from "../src/lib/passkey-sites";
import { addUser, testDb } from "./support/db";
import { fakeSession } from "./support/session";

const RP_ID = "tesoreria.finance";
const ORIGIN = "https://tesoreria.finance";

// The routes as the server runs them, with the session, the database, the settings and the chain standing in.
const state = vi.hoisted(() => ({ db: null as unknown, session: null as unknown }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/session", () => ({ getSession: async () => state.session }));
vi.mock("../src/lib/env", () => ({ env: () => ({ RP_ID: "tesoreria.finance", ORIGIN: "https://tesoreria.finance" }) }));
vi.mock("../src/lib/accounts", () => ({
  deriveAccount: async ({ publicKey }: { publicKey: Hex }) => getAddress(slice(keccak256(publicKey), 12)),
}));

const challengeRoute = await import("../src/app/api/auth/challenge/route");
const registerRoute = await import("../src/app/api/auth/register/route");
const loginRoute = await import("../src/app/api/auth/login/route");

let db: Db;
let session: ReturnType<typeof fakeSession>;

beforeEach(async () => {
  db = await testDb();
  state.db = db;
  session = fakeSession();
  state.session = session;
});

const post = (route: { POST: (request: Request) => Promise<Response> }, path: string, body: unknown) =>
  route.POST(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const register = (body: Record<string, unknown>) => post(registerRoute, "/api/auth/register", body);
const userHandle = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

describe("POST /api/auth/challenge", () => {
  it("answers with the challenge and the site new passkeys are made for", async () => {
    const answer = await challengeRoute.POST();
    expect(await answer.json()).toEqual({ challenge: session.challenge, rpId: RP_ID });
    expect(session.challenge).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("POST /api/auth/register", () => {
  it("registers a passkey from its attestation", async () => {
    const passkey = createFakePasskey({ rpId: RP_ID, origin: ORIGIN });
    const attested = passkey.attest({ challenge: issueChallenge(session) });
    const answer = await register({ name: "Ema", credentialId: passkey.credential.id, userHandle: userHandle(), ...attested });
    expect(answer.status).toBe(200);
    const [row] = await db.select().from(credentials).where(eq(credentials.id, passkey.credential.id));
    expect(row).toMatchObject({ publicKey: passkey.credential.publicKey, rpId: RP_ID, state: "active" });
  });

  it("answers a page that still posts the key itself with the bad-passkey message, not a malformed-request one", async () => {
    // A tab opened before the deploy: `publicKey` from the browser, and no attestation to read it from.
    const passkey = createFakePasskey({ rpId: RP_ID, origin: ORIGIN });
    const { clientDataJSON } = passkey.attest({ challenge: issueChallenge(session) });
    const before = (await db.select().from(users)).length;
    const answer = await register({
      name: "Ema",
      credentialId: passkey.credential.id,
      publicKey: passkey.credential.publicKey,
      userHandle: userHandle(),
      clientDataJSON,
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ error: es.auth.badPasskey });
    expect(es.auth.badPasskey).not.toBe(es.errors.badRequest);
    expect((await db.select().from(users)).length).toBe(before);
    expect(session.userId).toBeUndefined();
  });

  it("caps the attestation at 4096 bytes before anything reads it", async () => {
    const passkey = createFakePasskey({ rpId: RP_ID, origin: ORIGIN });
    const { clientDataJSON } = passkey.attest({ challenge: issueChallenge(session) });
    const withAttestation = (bytes: number) =>
      register({ name: "Ema", credentialId: passkey.credential.id, userHandle: userHandle(), clientDataJSON, attestationObject: `0x${"00".repeat(bytes)}` });
    const tooBig = await withAttestation(4097);
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toEqual({ error: es.errors.badRequest });
    // At the cap it gets through the schema, and the logic refuses what is not an attestation.
    const atTheCap = await withAttestation(4096);
    expect(atTheCap.status).toBe(400);
    expect(await atTheCap.json()).toEqual({ error: es.auth.badPasskey });
  });
});

describe("POST /api/auth/login", () => {
  it("lets in an old-site passkey from the new origin", async () => {
    const old = createFakePasskey({ rpId: LEGACY_RP_ID, origin: ORIGIN });
    const person = await addUser(db, "Ema");
    await db.insert(credentials).values({ id: old.credential.id, userId: person.id, publicKey: old.credential.publicKey, userHandle: userHandle(), rpId: LEGACY_RP_ID });
    const assertion = await signPasskeyChallenge({ challenge: issueChallenge(session), rpId: LEGACY_RP_ID, getFn: old.getFn });
    const answer = await post(loginRoute, "/api/auth/login", assertion);
    expect(answer.status).toBe(200);
    expect(session.userId).toBe(person.id);
  });
});
