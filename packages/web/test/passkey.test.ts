import { type Hex, bytesToHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RP_ID = "tesoreria.finance";
const LEGACY = "tesoreriaia.vercel.app";
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

import { createAccount, lastPasskeySite, logInWithPasskey } from "../src/lib/client/passkey";

/** The attestation a phone answers with: opaque bytes here, the server reads them. */
const ATTESTATION = new Uint8Array([0xa3, 0x63, 0x66, 0x6d, 0x74]);
const CLIENT_DATA = '{"type":"webauthn.create"}';

/** `localStorage` as a map, or a storage that throws (a private window, blocked site data). */
function storage(initial: Record<string, string> = {}, broken = false) {
  const items = new Map(Object.entries(initial));
  const fail = () => {
    if (broken) throw new DOMException("blocked", "SecurityError");
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (fail(), items.get(key) ?? null),
    setItem: (key: string, value: string) => (fail(), void items.set(key, value)),
  });
  return items;
}

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
  it("signs for the site the challenge names, and remembers it", async () => {
    const items = storage();
    await logInWithPasskey();
    expect(wallet.signPasskeyChallenge).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: RP_ID });
    expect(api.post).toHaveBeenLastCalledWith("/api/auth/login", { credentialId: "cred", signed: true });
    expect(items.get("tesoreria.passkey-site")).toBe("current");
  });

  it("signs for the old site when asked to, and remembers that instead", async () => {
    const items = storage();
    await logInWithPasskey("legacy");
    expect(wallet.signPasskeyChallenge).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: LEGACY });
    expect(items.get("tesoreria.passkey-site")).toBe("legacy");
  });

  it("goes back to the site it last logged in with", async () => {
    storage({ "tesoreria.passkey-site": "legacy" });
    await logInWithPasskey();
    expect(wallet.signPasskeyChallenge).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: LEGACY });
  });

  it("remembers nothing from a login that failed", async () => {
    const items = storage();
    api.post.mockImplementation(async (path: string) => {
      if (path === "/api/auth/login") throw new Error("unknown passkey");
      return { challenge: CHALLENGE, rpId: RP_ID };
    });
    await expect(logInWithPasskey("legacy")).rejects.toThrow("unknown passkey");
    expect(items.size).toBe(0);
  });

  it("logs in all the same when the browser won't keep anything", async () => {
    storage({}, true);
    await expect(logInWithPasskey("legacy")).resolves.toBeUndefined();
    expect(wallet.signPasskeyChallenge).toHaveBeenCalledWith({ challenge: CHALLENGE, rpId: LEGACY });
  });
});

describe("lastPasskeySite", () => {
  it("is the current site unless the old one was the last that worked", () => {
    expect(lastPasskeySite()).toBe("current"); // nothing saved
    storage({ "tesoreria.passkey-site": "legacy" });
    expect(lastPasskeySite()).toBe("legacy");
    storage({ "tesoreria.passkey-site": "current" });
    expect(lastPasskeySite()).toBe("current");
    storage({ "tesoreria.passkey-site": "somewhere-else" });
    expect(lastPasskeySite()).toBe("current");
  });

  it("is the current site when the storage fails, or there is none", () => {
    storage({ "tesoreria.passkey-site": "legacy" }, true);
    expect(lastPasskeySite()).toBe("current");
    vi.unstubAllGlobals(); // no localStorage at all: the reference itself throws
    expect(lastPasskeySite()).toBe("current");
  });
});
