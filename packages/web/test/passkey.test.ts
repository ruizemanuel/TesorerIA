import { type Hex, bytesToHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RP_ID = "tesoreria.finance";
const CHALLENGE: Hex = "0xc0ffee";

const wallet = vi.hoisted(() => ({ signPasskeyChallenge: vi.fn(async (_parameters: { challenge: Hex; rpId?: string }) => ({ credentialId: "cred", signed: true })) }));
vi.mock("@tesoreria/wallet", () => wallet);

const viem = vi.hoisted(() => ({ createWebAuthnCredential: vi.fn() }));
vi.mock("viem/account-abstraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem/account-abstraction")>()),
  createWebAuthnCredential: viem.createWebAuthnCredential,
}));

const api = vi.hoisted(() => ({ post: vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })) }));
vi.mock("../src/lib/client/api", () => api);

import { RefusedError } from "../src/lib/client/errors";
import { createAccount, logInWithPasskey } from "../src/lib/client/passkey";
import { SITE_KEY, stubLocalStorage as storage } from "./support/storage";

/** The attestation a phone answers with: opaque bytes here, the server reads them. */
const ATTESTATION = new Uint8Array([0xa3, 0x63, 0x66, 0x6d, 0x74]);
const CLIENT_DATA = '{"type":"webauthn.create"}';

beforeEach(() => {
  api.post.mockImplementation(async (path: string) => (path === "/api/auth/challenge" ? { challenge: CHALLENGE, rpId: RP_ID } : { ok: true }));
  viem.createWebAuthnCredential.mockResolvedValue({
    id: "newcred",
    publicKey: "0x04",
    raw: { response: { attestationObject: ATTESTATION.buffer, clientDataJSON: new TextEncoder().encode(CLIENT_DATA).buffer } },
  });
  storage();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("createAccount", () => {
  it("makes the passkey for the site the challenge names, and registers it by its attestation", async () => {
    await createAccount({ name: " Ema ", email: "ema@example.com" });

    const [creation] = viem.createWebAuthnCredential.mock.calls[0]!;
    expect(creation).toMatchObject({ challenge: CHALLENGE, rp: { id: RP_ID, name: "TesorerIA" }, name: "TesorerIA (Ema)" });
    expect(creation).not.toHaveProperty("attestation"); // "none", the default: the phone isn't asked to identify itself
    const [path, body] = api.post.mock.calls.at(-1)!;
    expect(path).toBe("/api/auth/register");
    expect(body).toEqual({
      name: " Ema ",
      email: "ema@example.com",
      credentialId: "newcred",
      attestationObject: bytesToHex(ATTESTATION),
      userHandle: bytesToHex(creation.user.id),
      clientDataJSON: CLIENT_DATA,
    });
    expect(body).not.toHaveProperty("publicKey"); // the server reads the key from the attestation, never from the browser's word
    expect(creation.user.id).toHaveLength(16);
  });
});

describe("logInWithPasskey", () => {
  it("signs for the site the challenge names, and logs in with the assertion", async () => {
    await logInWithPasskey();
    expect(wallet.signPasskeyChallenge).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: RP_ID });
    expect(api.post).toHaveBeenLastCalledWith("/api/auth/login", { credentialId: "cred", signed: true });
  });

  it("ignores a site that an earlier version remembered, and writes nothing to the browser's storage", async () => {
    const items = storage({ [SITE_KEY]: "legacy" });
    await logInWithPasskey();
    expect(wallet.signPasskeyChallenge).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: RP_ID });
    expect(items.get(SITE_KEY)).toBe("legacy"); // left as it was: nothing reads it
    expect(items.size).toBe(1);
  });

  it("surfaces a refusal as it is, without a second prompt", async () => {
    api.post.mockImplementation(async (path: string) => {
      if (path === "/api/auth/login") throw new RefusedError("No pudimos reconocer tu passkey.", 401);
      return { challenge: CHALLENGE, rpId: RP_ID };
    });

    await expect(logInWithPasskey()).rejects.toThrow("No pudimos reconocer tu passkey.");

    expect(wallet.signPasskeyChallenge).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls.filter(([path]) => path === "/api/auth/login")).toHaveLength(1);
  });

  it("does not ask the server to log in when the person cancelled the prompt", async () => {
    wallet.signPasskeyChallenge.mockRejectedValueOnce(new DOMException("not allowed", "NotAllowedError"));
    await expect(logInWithPasskey()).rejects.toThrow("not allowed");
    expect(api.post.mock.calls.some(([path]) => path === "/api/auth/login")).toBe(false);
  });
});
