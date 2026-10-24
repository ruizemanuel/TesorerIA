import { type Address, type Chain, type Hash, type Hex, getAddress, http, pad } from "viem";
import { createBundlerClient, entryPoint07Address } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The wallet package is covered by its own tests: here only what sendCalls decides around it.
type Owner = { sign(parameters: { hash: Hex }): Promise<unknown> };
type Sent = { onSent(userOpHash: Hash): Promise<void>; nonce?: bigint };
type Account = { address: Address; getNonce?: (parameters?: { key?: bigint }) => Promise<bigint> };
const wallet = vi.hoisted(() => ({
  createMemberAccount: vi.fn<(parameters: { owner: Owner; address?: Address }) => Promise<Account>>(),
  createPimlicoBundlerClient: vi.fn((_parameters: { transport: (options: { chain: Chain }) => { config: { timeout: number } } }) => ({ bundler: true })),
  sendTaggedCalls: vi.fn<(parameters: Sent) => Promise<unknown>>(),
}));
vi.mock("@tesoreria/wallet", () => wallet);

const passkey = vi.hoisted(() => {
  const sign = vi.fn(async (_parameters: { hash: Hex }) => ({ signature: "0xsigned" }));
  return { sign, account: vi.fn((_parameters: { credential: object; rpId?: string }) => ({ type: "webAuthn", sign })) };
});
vi.mock("viem/account-abstraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem/account-abstraction")>()),
  toWebAuthnAccount: passkey.account,
}));

const api = vi.hoisted(() => ({ post: vi.fn(async (_path: string, _body?: unknown) => ({ ok: true })), get: vi.fn() }));
vi.mock("../src/lib/client/api", () => api);

import { OnItsWayError, UserFacingError, userMessage } from "../src/lib/client/errors";
import { type Me, loadMe, sendCalls, settleOperation } from "../src/lib/client/wallet";
import { es } from "../src/lib/i18n/es";
import { LEGACY_RP_ID } from "../src/lib/passkey-sites";
import { SITE_KEY, stubLocalStorage } from "./support/storage";

const ACCOUNT = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
// A member of the old site, who has not changed their key: the Safe holds this passkey, made for LEGACY_RP_ID.
const me: Me = {
  name: "Ema",
  account: ACCOUNT,
  credential: { id: "cred", publicKey: "0x1234", rpId: LEGACY_RP_ID },
  keyChange: { due: true, pending: null, ready: false, onItsWay: false },
};
const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const OP: Hash = pad("0x01", { size: 32 });
const TX: Hash = pad("0x02", { size: 32 });
const BLOCK = 79_925_582n;
const CALLS = [{ to: FUND, data: "0x" as const }];
const INFO = { kind: "contribute", fund: FUND, amount: 10_000_000n, token: "usdt" } as const;
const RECEIPT = { userOpHash: OP, transactionHash: TX, blockNumber: BLOCK, success: true, reason: undefined };
/** The account's EntryPoint nonce, as the Safe reads it. */
const NONCE = vi.fn(async (_parameters?: { key?: bigint }) => 7n);

/** The operations the page told the server about, in order. */
const posted = () => api.post.mock.calls.map(([path, body]) => [path, body] as const);

/** What viem throws when the bundler (through /api/bundler) answers a send with this JSON-RPC error: the real error, not one built by hand. */
async function refusedByBundler(message: string): Promise<unknown> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const { id } = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32507, message } }), { headers: { "content-type": "application/json" } });
    }),
  );
  return createBundlerClient({ transport: http("http://localhost:3000/api/bundler") })
    .sendUserOperation({
      sender: ACCOUNT,
      nonce: 0n,
      callData: "0x",
      callGasLimit: 1n,
      verificationGasLimit: 1n,
      preVerificationGas: 1n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      signature: "0x",
      entryPointAddress: entryPoint07Address,
    })
    .catch((error: unknown) => error);
}

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  wallet.createMemberAccount.mockImplementation(async () => ({ address: ACCOUNT, getNonce: NONCE }));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("loadMe", () => {
  it("remembers the site of the passkey the server says is active, so the next login asks for that one", async () => {
    const items = stubLocalStorage();
    api.get.mockResolvedValueOnce(me);
    await expect(loadMe()).resolves.toBe(me);
    expect(api.get).toHaveBeenCalledWith("/api/me");
    expect(items.get(SITE_KEY)).toBe("legacy"); // an old-site passkey is the active one

    // Once the key was changed, from this browser or from another device, the active passkey is the new site's.
    const renewed: Me = { ...me, credential: { id: "new", publicKey: "0xabcd", rpId: "tesoreria.finance" } };
    api.get.mockResolvedValueOnce(renewed);
    await loadMe();
    expect(items.get(SITE_KEY)).toBe("current");
  });

  it("replaces a site that was remembered wrongly, in either direction", async () => {
    const items = stubLocalStorage({ [SITE_KEY]: "legacy" });
    api.get.mockResolvedValueOnce({ ...me, credential: { ...me.credential, rpId: "tesoreria.finance" } });
    await loadMe();
    expect(items.get(SITE_KEY)).toBe("current");

    api.get.mockResolvedValueOnce(me);
    await loadMe();
    expect(items.get(SITE_KEY)).toBe("legacy");
  });

  it("still answers when the browser won't keep anything, and when the server can't", async () => {
    stubLocalStorage({}, true);
    api.get.mockResolvedValueOnce(me);
    await expect(loadMe()).resolves.toBe(me);

    const items = stubLocalStorage({ [SITE_KEY]: "legacy" });
    api.get.mockRejectedValueOnce(new UserFacingError("Entrá con tu passkey."));
    await expect(loadMe()).rejects.toThrow("Entrá con tu passkey.");
    expect(items.get(SITE_KEY)).toBe("legacy"); // nothing was learned
  });
});

describe("sendCalls", () => {
  it("records the operation before the receipt, then the receipt, and says when the passkey signed", async () => {
    const events: string[] = [];
    api.post.mockImplementation(async (path: string) => {
      events.push(`post ${path}`);
      return { ok: true };
    });
    wallet.sendTaggedCalls.mockImplementation(async ({ onSent }) => {
      // What sendUserOperation does: the Safe asks its owner to sign, then the bundler takes the operation.
      const { owner } = wallet.createMemberAccount.mock.calls[0]![0];
      await owner.sign({ hash: "0xdead" });
      events.push("sent");
      await onSent(OP);
      events.push("receipt");
      return RECEIPT;
    });

    const result = await sendCalls(me, CALLS, INFO, () => events.push("signed"));

    expect(result).toEqual(RECEIPT);
    expect(events).toEqual(["signed", "sent", "post /api/operations", "receipt", "post /api/operations/done"]);
    expect(posted()).toEqual([
      ["/api/operations", { kind: "contribute", fund: FUND, amount: "10000000", token: "usdt", userOpHash: OP }],
      ["/api/operations/done", { userOpHash: OP, transactionHash: TX, blockNumber: "79925582", success: true }],
    ]);
    expect(passkey.sign).toHaveBeenCalledWith({ hash: "0xdead" });
  });

  it("reports a landed operation done even if its receipt carries no block, instead of failing it after the fact", async () => {
    // viem types the block as a bigint but reads null from a receipt without one: that mustn't turn a landed operation
    // into a "probá de nuevo", which would invite a second contribution.
    wallet.sendTaggedCalls.mockResolvedValue({ ...RECEIPT, blockNumber: null });

    const result = await sendCalls(me, CALLS, INFO);

    expect(result).toEqual({ ...RECEIPT, blockNumber: null });
    const [path, body] = posted().at(-1)!;
    expect(path).toBe("/api/operations/done");
    expect(body).toEqual({ userOpHash: OP, transactionHash: TX, success: true });
    expect(JSON.stringify(body)).not.toContain("blockNumber"); // what the server reads: the field is optional
  });

  it("signs with the active passkey's site and the account's own address", async () => {
    wallet.sendTaggedCalls.mockResolvedValue(RECEIPT);
    await sendCalls(me, CALLS, INFO);
    // The passkey is asked for on its own site, not the page's, and the Safe keeps its address whatever its key now derives.
    expect(passkey.account).toHaveBeenCalledWith({ credential: me.credential, rpId: LEGACY_RP_ID });
    expect(wallet.createMemberAccount).toHaveBeenCalledWith(expect.objectContaining({ address: ACCOUNT }));

    // A member who already changed their key signs for the new site.
    const renewed: Me = { ...me, credential: { id: "new", publicKey: "0xabcd", rpId: "tesoreria.finance" } };
    await sendCalls(renewed, CALLS, INFO);
    expect(passkey.account).toHaveBeenLastCalledWith({ credential: renewed.credential, rpId: "tesoreria.finance" });
  });

  it("shows wrongPasskey when the bundler refuses the signature (AA24)", async () => {
    wallet.sendTaggedCalls.mockRejectedValue(await refusedByBundler("UserOperation reverted during simulation with reason: AA24 signature error"));
    const error = await sendCalls(me, CALLS, INFO).catch((caught) => caught);
    expect(userMessage(error, es)).toBe("Tu passkey no coincide con tu cuenta. Entrá de nuevo.");
    expect(error).not.toBeInstanceOf(OnItsWayError); // it never left: signing again is the right thing
    expect(api.post).not.toHaveBeenCalled();

    // Any other refusal keeps its generic sentence.
    wallet.sendTaggedCalls.mockRejectedValue(await refusedByBundler("UserOperation reverted during simulation with reason: AA21 didn't pay prefund"));
    expect(userMessage(await sendCalls(me, CALLS, INFO).catch((caught) => caught), es)).toBe(
      "No se pudo completar. Probá de nuevo en un rato.",
    );
  });

  it("lets an error from before the operation left pass through untouched", async () => {
    const cancelled = Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" });
    wallet.sendTaggedCalls.mockRejectedValue(cancelled);
    await expect(sendCalls(me, CALLS, INFO)).rejects.toBe(cancelled);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("says a failed operation moved nothing, and still tells the server", async () => {
    wallet.sendTaggedCalls.mockResolvedValue({ ...RECEIPT, success: false, reason: "reverted" });
    const error = await sendCalls(me, CALLS, INFO).catch((caught) => caught);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.key).toBe("notCompleted");
    expect(userMessage(error, es)).toBe("La operación no se pudo completar. No se movió plata.");
    expect(error).not.toBeInstanceOf(OnItsWayError); // it landed and failed: trying again is the right thing
    expect(posted().at(-1)).toEqual(["/api/operations/done", { userOpHash: OP, transactionHash: TX, blockNumber: "79925582", success: false }]);
  });

  it("keeps trying to record an operation that is out, and never asks to send it again", async () => {
    // onSent fails (the server is down), then the receipt wait fails too: the error only names the hash.
    api.post.mockRejectedValueOnce(new UserFacingError("Algo falló. Probá de nuevo.")).mockResolvedValue({ ok: true });
    wallet.sendTaggedCalls.mockImplementation(async ({ onSent }) => {
      await onSent(OP).catch(() => {});
      throw new Error(`UserOperation ${OP} was sent but its receipt is unknown (timeout); its hash was not recorded`);
    });

    const error = await sendCalls(me, CALLS, INFO).catch((caught) => caught);

    expect(error).toBeInstanceOf(OnItsWayError);
    expect(userMessage(error, es)).toMatch(/en camino/);
    expect(userMessage(error, es)).not.toMatch(/prob[aá] de nuevo/i);
    expect(posted()).toEqual([
      ["/api/operations", expect.objectContaining({ userOpHash: OP })],
      ["/api/operations", expect.objectContaining({ userOpHash: OP })],
    ]);
  });

  it("tells a timeout after a recorded send that it is on its way too, without recording it twice over", async () => {
    wallet.sendTaggedCalls.mockImplementation(async ({ onSent }) => {
      await onSent(OP);
      throw new Error("Timed out while waiting for User Operation receipt.");
    });
    const error = await sendCalls(me, CALLS, INFO).catch((caught) => caught);
    expect(error).toBeInstanceOf(OnItsWayError);
    expect(userMessage(error, es)).toMatch(/en camino/);
    expect(posted().every(([path]) => path === "/api/operations")).toBe(true); // idempotent: the server keeps one row
  });

  it("records, once the receipt is in, an operation whose record failed while it waited", async () => {
    api.post.mockRejectedValueOnce(new UserFacingError("Algo falló. Probá de nuevo.")).mockResolvedValue({ ok: true });
    wallet.sendTaggedCalls.mockImplementation(async ({ onSent }) => {
      await onSent(OP).catch(() => {});
      return { ...RECEIPT, unrecorded: "Algo falló." };
    });
    await sendCalls(me, CALLS, INFO);
    expect(posted().map(([path]) => path)).toEqual(["/api/operations", "/api/operations", "/api/operations/done"]);
  });

  it("passes the draft a create-fund deploys on to the server", async () => {
    wallet.sendTaggedCalls.mockImplementation(async ({ onSent }) => {
      await onSent(OP);
      return RECEIPT;
    });
    const draftId = crypto.randomUUID();
    await sendCalls(me, CALLS, { kind: "create-fund", draftId });
    expect(posted()[0]).toEqual(["/api/operations", { kind: "create-fund", draftId, nonce: "7", userOpHash: OP }]);
  });

  it("sends a createFund with the account's key-0 nonce, or the one it's pinned to, and records it either way", async () => {
    wallet.sendTaggedCalls.mockImplementation(async ({ onSent }) => {
      await onSent(OP);
      return RECEIPT;
    });
    await sendCalls(me, CALLS, { kind: "create-fund", draftId: crypto.randomUUID() });
    expect(NONCE).toHaveBeenCalledWith({ key: 0n });
    expect(wallet.sendTaggedCalls.mock.calls[0]![0].nonce).toBe(7n);

    vi.clearAllMocks();
    await sendCalls(me, CALLS, { kind: "create-fund", draftId: crypto.randomUUID() }, undefined, 5n);
    expect(NONCE).not.toHaveBeenCalled();
    expect(wallet.sendTaggedCalls.mock.calls[0]![0].nonce).toBe(5n);
    expect(posted()[0]![1]).toMatchObject({ nonce: "5" });
  });

  it("lets a contribution or a vote take its own nonce key, as before: two of them can be out at once", async () => {
    wallet.sendTaggedCalls.mockImplementation(async ({ onSent }) => {
      await onSent(OP);
      return RECEIPT;
    });
    await sendCalls(me, CALLS, INFO);
    await sendCalls(me, CALLS, { kind: "vote", fund: FUND });
    expect(NONCE).not.toHaveBeenCalled();
    expect(wallet.sendTaggedCalls.mock.calls.map(([parameters]) => parameters.nonce)).toEqual([undefined, undefined]);
    const recorded = posted().filter(([path]) => path === "/api/operations");
    expect(recorded.map(([, body]) => (body as { nonce?: unknown }).nonce)).toEqual([undefined, undefined]); // and JSON leaves it out
  });

  it("waits for /api/bundler longer than it waits for Pimlico (30 s), so a slow send is never taken for an unsent one", async () => {
    wallet.sendTaggedCalls.mockResolvedValue(RECEIPT);
    await sendCalls(me, CALLS, INFO);
    const { transport } = wallet.createPimlicoBundlerClient.mock.calls[0]![0];
    expect(transport({ chain: celo }).config.timeout).toBeGreaterThan(30_000);
  });
});

describe("settleOperation", () => {
  /** /api/bundler answering eth_getUserOperationReceipt with `result`; the requests it got. */
  function bundler(result: unknown) {
    const requests: { url: string; method: string; params: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        const { id, method, params } = JSON.parse(init.body);
        requests.push({ url: String(url), method, params });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
      }),
    );
    return requests;
  }

  it("records the receipt of an operation that went out earlier", async () => {
    const requests = bundler({
      userOpHash: OP,
      entryPoint: entryPoint07Address,
      sender: ACCOUNT,
      nonce: "0x1",
      actualGasCost: "0x1",
      actualGasUsed: "0x1",
      success: false,
      logs: [],
      receipt: { transactionHash: TX, blockNumber: "0x1", logs: [], status: "0x1" },
    });
    await settleOperation(OP);
    expect(requests).toEqual([{ url: "http://localhost:3000/api/bundler", method: "eth_getUserOperationReceipt", params: [OP] }]);
    expect(posted()).toEqual([["/api/operations/done", { userOpHash: OP, transactionHash: TX, blockNumber: "1", success: false }]]);
  });

  it("records the receipt of an operation even if it carries no block", async () => {
    bundler({
      userOpHash: OP,
      entryPoint: entryPoint07Address,
      sender: ACCOUNT,
      nonce: "0x1",
      actualGasCost: "0x1",
      actualGasUsed: "0x1",
      success: true,
      logs: [],
      receipt: { transactionHash: TX, logs: [], status: "0x1" },
    });
    await expect(settleOperation(OP)).resolves.toBeUndefined();
    const [path, body] = posted().at(-1)!;
    expect(path).toBe("/api/operations/done");
    expect(body).toEqual({ userOpHash: OP, transactionHash: TX, success: true });
    expect(JSON.stringify(body)).not.toContain("blockNumber");
  });

  it("says it's on its way, and records nothing, while the bundler has no receipt for it", async () => {
    bundler(null);
    const error = await settleOperation(OP).catch((caught) => caught);
    expect(error).toBeInstanceOf(OnItsWayError);
    expect(userMessage(error, es)).toMatch(/en camino/);
    expect(api.post).not.toHaveBeenCalled();
  });
});
