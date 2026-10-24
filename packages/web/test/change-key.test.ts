import { type Address, type Hash, type Hex, getAddress, pad } from "viem";
import { UserOperationExecutionError, UserOperationSignatureError } from "viem/account-abstraction";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The wallet package is covered by its own tests: here only what changeKey decides around it.
type Sent = { account: unknown; publicKey: Hex; onSent(userOpHash: Hash): Promise<void> };
const wallet = vi.hoisted(() => ({
  createMemberAccount: vi.fn(async (_parameters: { address?: Address }) => ({ address: "0xaccount" })),
  createPimlicoBundlerClient: vi.fn((_parameters: object) => ({ bundler: true })),
  sendTaggedCalls: vi.fn(),
  sendKeyChange: vi.fn<(parameters: Sent) => Promise<unknown>>(),
  signPasskeyChallenge: vi.fn(async (_parameters: { challenge: Hex; credentialId?: string; rpId?: string }) => ({ credentialId: "pending", signed: true })),
}));
vi.mock("@tesoreria/wallet", () => wallet);

const passkey = vi.hoisted(() => ({
  account: vi.fn((_parameters: { credential: object; rpId?: string }) => ({ type: "webAuthn", sign: async () => ({}) })),
}));
vi.mock("viem/account-abstraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem/account-abstraction")>()),
  toWebAuthnAccount: passkey.account,
}));

const created = vi.hoisted(() => ({
  createPasskey: vi.fn(async (_name: string) => ({ credentialId: "fresh", attestationObject: "0xa1", userHandle: "0xb2", clientDataJSON: "{}" })),
  freshChallenge: vi.fn(async () => ({ challenge: "0xc0ffee" as Hex, rpId: "tesoreria.finance" })),
}));
// Only the passkeys it makes and the challenge are replaced: the memory of the site is the real one, over a stubbed storage.
vi.mock("../src/lib/client/passkey", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/lib/client/passkey")>()), ...created }));

const api = vi.hoisted(() => ({ post: vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })), get: vi.fn() }));
vi.mock("../src/lib/client/api", () => api);

import { changeKey } from "../src/lib/client/key-change";
import { RefusedError, UserFacingError, userMessage } from "../src/lib/client/errors";
import type { Me } from "../src/lib/client/wallet";
import { es } from "../src/lib/i18n/es";
import { LEGACY_RP_ID } from "../src/lib/passkey-sites";
import { SITE_KEY, stubLocalStorage } from "./support/storage";

const ACCOUNT = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const OLD = { id: "old", publicKey: "0x1234", rpId: LEGACY_RP_ID } as const;
const PENDING = { id: "pending", rpId: "tesoreria.finance", publicKey: "0xabcd" } as const;
const OP: Hash = pad("0x01", { size: 32 });
const TX: Hash = pad("0x02", { size: 32 });
const RECEIPT = { userOpHash: OP, transactionHash: TX, blockNumber: 79_925_582n, success: true, reason: undefined };

/** A member of the old site as /api/me describes them, with the key change in the state given. */
function member(keyChange: Partial<Me["keyChange"]> = {}): Me {
  return { name: "Ema", account: ACCOUNT, credential: OLD, keyChange: { due: true, pending: null, ready: false, onItsWay: false, ...keyChange } };
}

/** What each of our routes answers; a route set to an error answers with it. */
const routes: Record<string, unknown> = {};
function answers(overrides: Record<string, unknown> = {}) {
  for (const key of Object.keys(routes)) delete routes[key];
  Object.assign(routes, { "/api/auth/key": { publicKey: "0xnewkey" }, "/api/auth/key/confirm": { result: "changed" } }, overrides);
}
const posted = () => api.post.mock.calls.map(([path]) => path);
/** The steps `changeKey` reported. */
function run(me: Me) {
  const steps: string[] = [];
  return { steps, result: changeKey(me, (step) => steps.push(step)) };
}

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  stubLocalStorage();
  answers();
  api.post.mockImplementation(async (path: string) => {
    const answer = routes[path] ?? { ok: true };
    if (answer instanceof Error) throw answer;
    return answer;
  });
  wallet.sendKeyChange.mockImplementation(async ({ onSent }) => {
    await onSent(OP);
    return RECEIPT;
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the site remembered for the next login", () => {
  // The old passkey is retired once the change is confirmed: from then on the main login button must ask for the new one.
  const READY = () => member({ pending: PENDING, ready: true });

  it("becomes the current one once the change is confirmed", async () => {
    const items = stubLocalStorage({ [SITE_KEY]: "legacy" });
    await expect(changeKey(READY())).resolves.toBe("changed");
    expect(items.get(SITE_KEY)).toBe("current");
  });

  it("does too when another tab or /api/me had confirmed it already", async () => {
    const items = stubLocalStorage({ [SITE_KEY]: "legacy" });
    answers({ "/api/auth/key/confirm": { result: "none" } });
    await expect(changeKey(READY())).resolves.toBe("changed");
    expect(items.get(SITE_KEY)).toBe("current");
  });

  it("stays the old one while the chain doesn't show the new key yet: the old passkey is still the active one", async () => {
    const items = stubLocalStorage({ [SITE_KEY]: "legacy" });
    answers({ "/api/auth/key/confirm": { result: "waiting" } });
    await expect(changeKey(READY())).resolves.toBe("waiting");
    answers({ "/api/auth/key/confirm": new RefusedError({ key: "failed" }, 500) });
    await expect(changeKey(READY())).resolves.toBe("waiting");
    expect(items.get(SITE_KEY)).toBe("legacy");
  });

  it("stays the old one when the change doesn't go out", async () => {
    const items = stubLocalStorage({ [SITE_KEY]: "legacy" });
    wallet.sendKeyChange.mockRejectedValue(Object.assign(new Error("not allowed"), { name: "NotAllowedError" }));
    await expect(changeKey(READY())).rejects.toThrow("not allowed");
    expect(items.get(SITE_KEY)).toBe("legacy");
  });

  it("does not stop the change when the browser won't keep anything", async () => {
    stubLocalStorage({}, true);
    await expect(changeKey(READY())).resolves.toBe("changed");
  });
});

describe("changeKey", () => {
  it("makes the new passkey, swaps the Safe's key to it signing with the old one, and confirms", async () => {
    const { steps, result } = run(member());

    await expect(result).resolves.toBe("changed");
    expect(steps).toEqual(["create", "sign", "confirm"]);
    expect(created.createPasskey).toHaveBeenCalledWith("Ema");
    expect(api.post).toHaveBeenCalledWith("/api/auth/key", { credentialId: "fresh", attestationObject: "0xa1", userHandle: "0xb2", clientDataJSON: "{}" });
    // The old passkey signs, for its own site, at the Safe's own address; the key it swaps to is the one the server read.
    expect(passkey.account).toHaveBeenCalledWith({ credential: OLD, rpId: LEGACY_RP_ID });
    expect(wallet.createMemberAccount).toHaveBeenCalledWith(expect.objectContaining({ address: ACCOUNT }));
    expect(wallet.sendKeyChange).toHaveBeenCalledWith(expect.objectContaining({ publicKey: "0xnewkey", bundlerClient: { bundler: true } }));
    expect(posted()).toEqual(["/api/auth/key", "/api/operations", "/api/operations/done", "/api/auth/key/confirm"]);
    expect(api.post).toHaveBeenCalledWith("/api/operations", { kind: "key-change", userOpHash: OP });
    expect(api.post).toHaveBeenCalledWith("/api/operations/done", { userOpHash: OP, transactionHash: TX, blockNumber: "79925582", success: true });
  });

  it("swaps to the pending passkey's key without making another, when this session made or proved it", async () => {
    const { steps, result } = run(member({ pending: PENDING, ready: true }));

    await expect(result).resolves.toBe("changed");
    expect(steps).toEqual(["sign", "confirm"]);
    expect(created.createPasskey).not.toHaveBeenCalled();
    expect(wallet.sendKeyChange).toHaveBeenCalledWith(expect.objectContaining({ publicKey: PENDING.publicKey }));
  });

  it("proves this device holds the pending passkey, on its own site, before swapping to it", async () => {
    const { steps, result } = run(member({ pending: PENDING }));

    await expect(result).resolves.toBe("changed");
    expect(steps).toEqual(["prove", "sign", "confirm"]);
    expect(wallet.signPasskeyChallenge).toHaveBeenCalledWith({ challenge: "0xc0ffee", credentialId: PENDING.id, rpId: PENDING.rpId });
    expect(api.post).toHaveBeenCalledWith("/api/auth/key/prove", { credentialId: "pending", signed: true });
    expect(created.createPasskey).not.toHaveBeenCalled();
    expect(wallet.sendKeyChange).toHaveBeenCalledWith(expect.objectContaining({ publicKey: PENDING.publicKey }));
  });

  it("makes a new passkey when this device doesn't have the pending one", async () => {
    // The browser answers the same when the person has no such passkey here as when they dismiss the prompt.
    wallet.signPasskeyChallenge.mockRejectedValueOnce(Object.assign(new Error("not allowed"), { name: "NotAllowedError" }));
    const { steps, result } = run(member({ pending: PENDING }));

    await expect(result).resolves.toBe("changed");
    expect(steps).toEqual(["prove", "create", "sign", "confirm"]);
    expect(posted()).not.toContain("/api/auth/key/prove"); // nothing was signed to prove
    expect(wallet.sendKeyChange).toHaveBeenCalledWith(expect.objectContaining({ publicKey: "0xnewkey" })); // the new one's, not the pending one's
  });

  it("stops at a prove that fails for any other reason", async () => {
    answers({ "/api/auth/key/prove": new UserFacingError("Esa passkey no tiene una cuenta acá.") });
    const { steps, result } = run(member({ pending: PENDING }));

    await expect(result).rejects.toThrow("Esa passkey no tiene una cuenta acá.");
    expect(steps).toEqual(["prove"]);
    expect(created.createPasskey).not.toHaveBeenCalled();
    expect(wallet.sendKeyChange).not.toHaveBeenCalled();
  });

  it("only confirms while a key change is on its way: no passkey is made and nothing is sent", async () => {
    answers({ "/api/auth/key/confirm": { result: "waiting" } });
    const { steps, result } = run(member({ pending: PENDING, onItsWay: true }));

    await expect(result).resolves.toBe("waiting");
    expect(steps).toEqual(["confirm"]);
    expect(created.createPasskey).not.toHaveBeenCalled();
    expect(wallet.signPasskeyChallenge).not.toHaveBeenCalled();
    expect(wallet.sendKeyChange).not.toHaveBeenCalled();
    expect(posted()).toEqual(["/api/auth/key/confirm"]);
  });

  describe("when the server refuses to start", () => {
    it("goes to confirm on a 409: a change is on its way, or the Safe already holds the key", async () => {
      answers({ "/api/auth/key": new RefusedError("Tu operación está en camino.", 409), "/api/auth/key/confirm": { result: "waiting" } });
      const { steps, result } = run(member());

      await expect(result).resolves.toBe("waiting");
      expect(steps).toEqual(["create", "confirm"]);
      expect(wallet.sendKeyChange).not.toHaveBeenCalled();
    });

    it("tells the person to try again later on a 503: the chain couldn't be read", async () => {
      answers({ "/api/auth/key": new RefusedError({ key: "failed" }, 503) }); // however the answer was worded, or if it had no words
      const { steps, result } = run(member());

      const error = await result.catch((caught) => caught);
      expect(error).toBeInstanceOf(UserFacingError);
      expect(userMessage(error, es)).toBe("No se pudo completar. Probá de nuevo en un rato.");
      expect(steps).toEqual(["create"]);
      expect(wallet.sendKeyChange).not.toHaveBeenCalled();
    });

    it("lets any other refusal through as the route worded it", async () => {
      answers({ "/api/auth/key": new RefusedError("Esa passkey no se pudo registrar.", 400) });
      await expect(changeKey(member())).rejects.toThrow("Esa passkey no se pudo registrar.");
      expect(wallet.sendKeyChange).not.toHaveBeenCalled();
    });
  });

  describe("once the change is sent", () => {
    it("waits for the chain to say when its receipt doesn't come", async () => {
      answers({ "/api/auth/key/confirm": { result: "waiting" } });
      wallet.sendKeyChange.mockImplementation(async ({ onSent }) => {
        await onSent(OP);
        throw new Error("Timed out while waiting for User Operation receipt.");
      });
      const { steps, result } = run(member({ pending: PENDING, ready: true }));

      await expect(result).resolves.toBe("waiting");
      expect(steps).toEqual(["sign", "confirm"]);
      expect(api.post).toHaveBeenCalledWith("/api/operations", { kind: "key-change", userOpHash: OP }); // recorded as it went out
    });

    it("confirms from the chain when the receipt wait is refused because another tab confirmed meanwhile", async () => {
      wallet.sendKeyChange.mockImplementation(async ({ onSent }) => {
        await onSent(OP);
        throw new Error("HTTP request failed. Status: 403");
      });
      await expect(changeKey(member({ pending: PENDING, ready: true }))).resolves.toBe("changed");
      expect(posted()).toContain("/api/auth/key/confirm");
    });

    it("says waiting when the confirmation itself fails: the operation is out, and the next /api/me confirms it", async () => {
      answers({ "/api/auth/key/confirm": new RefusedError("Algo falló. Probá de nuevo.", 500) });
      await expect(changeKey(member({ pending: PENDING, ready: true }))).resolves.toBe("waiting");
    });

    it("says waiting while the Safe still holds the old key, and changed once it holds the new one", async () => {
      answers({ "/api/auth/key/confirm": { result: "waiting" } });
      await expect(changeKey(member({ pending: PENDING, ready: true }))).resolves.toBe("waiting");
      answers({ "/api/auth/key/confirm": { result: "changed" } });
      await expect(changeKey(member({ pending: PENDING, ready: true }))).resolves.toBe("changed");
    });

    it("says changed when nothing is pending any more: another tab or /api/me confirmed it first", async () => {
      answers({ "/api/auth/key/confirm": { result: "none" } });
      await expect(changeKey(member({ pending: PENDING, ready: true }))).resolves.toBe("changed");
    });

    it("tells the server when the operation landed and failed, and doesn't confirm it", async () => {
      wallet.sendKeyChange.mockImplementation(async ({ onSent }) => {
        await onSent(OP);
        return { ...RECEIPT, success: false, reason: "reverted" };
      });
      const error = await changeKey(member({ pending: PENDING, ready: true })).catch((caught) => caught);

      expect(error).toBeInstanceOf(UserFacingError);
      expect(userMessage(error, es)).toBe("La operación no se pudo completar. No se movió plata.");
      expect(api.post).toHaveBeenCalledWith("/api/operations/done", expect.objectContaining({ userOpHash: OP, success: false }));
      expect(posted()).not.toContain("/api/auth/key/confirm");
    });
  });

  describe("when the change never left", () => {
    it("shows the error as it is, without confirming anything", async () => {
      const refused = new UserOperationExecutionError(new UserOperationSignatureError({}), {} as never);
      wallet.sendKeyChange.mockRejectedValue(refused);
      const { steps, result } = run(member({ pending: PENDING, ready: true }));

      const error = await result.catch((caught) => caught);
      expect(error).toBe(refused);
      expect(userMessage(error, es)).toBe("Tu passkey no coincide con tu cuenta. Entrá de nuevo.");
      expect(steps).toEqual(["sign"]);
      expect(posted()).toEqual([]);
    });

    it("lets a dismissed passkey prompt through, to be shown as a cancel", async () => {
      wallet.sendKeyChange.mockRejectedValue(Object.assign(new Error("not allowed"), { name: "NotAllowedError" }));
      const error = await changeKey(member({ pending: PENDING, ready: true })).catch((caught) => caught);
      expect(userMessage(error, es)).toBe("Cancelaste la confirmación. Probá de nuevo.");
      expect(posted()).toEqual([]);
    });
  });
});
