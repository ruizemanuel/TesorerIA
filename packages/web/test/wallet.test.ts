import { type Address, type Chain, type Hash, type Hex, getAddress, pad } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The wallet package is covered by its own tests: here only what sendCalls decides around it.
type Owner = { sign(parameters: { hash: Hex }): Promise<unknown> };
type Sent = { onSent(userOpHash: Hash): Promise<void>; nonce?: bigint };
type Account = { address: Address; getNonce?: (parameters?: { key?: bigint }) => Promise<bigint> };
const wallet = vi.hoisted(() => ({
  createMemberAccount: vi.fn<(parameters: { owner: Owner }) => Promise<Account>>(),
  createPimlicoBundlerClient: vi.fn((_parameters: { transport: (options: { chain: Chain }) => { config: { timeout: number } } }) => ({ bundler: true })),
  sendTaggedCalls: vi.fn<(parameters: Sent) => Promise<unknown>>(),
}));
vi.mock("@tesoreria/wallet", () => wallet);

const passkey = vi.hoisted(() => ({ sign: vi.fn(async (_parameters: { hash: Hex }) => ({ signature: "0xsigned" })) }));
vi.mock("viem/account-abstraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem/account-abstraction")>()),
  toWebAuthnAccount: vi.fn(() => ({ type: "webAuthn", sign: passkey.sign })),
}));

const api = vi.hoisted(() => ({ post: vi.fn(async (_path: string, _body?: unknown) => ({ ok: true })), get: vi.fn() }));
vi.mock("../src/lib/client/api", () => api);

import { UserFacingError } from "../src/lib/client/errors";
import { type Me, sendCalls, settleOperation } from "../src/lib/client/wallet";

const ACCOUNT = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const me: Me = { name: "Ema", account: ACCOUNT, credential: { id: "cred", publicKey: "0x1234" } };
const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const OP: Hash = pad("0x01", { size: 32 });
const TX: Hash = pad("0x02", { size: 32 });
const CALLS = [{ to: FUND, data: "0x" as const }];
const INFO = { kind: "contribute", fund: FUND, amount: 10_000_000n, token: "usdt" } as const;
const RECEIPT = { userOpHash: OP, transactionHash: TX, success: true, reason: undefined };
/** The account's EntryPoint nonce, as the Safe reads it. */
const NONCE = vi.fn(async (_parameters?: { key?: bigint }) => 7n);

/** The operations the page told the server about, in order. */
const posted = () => api.post.mock.calls.map(([path, body]) => [path, body] as const);

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  wallet.createMemberAccount.mockImplementation(async () => ({ address: ACCOUNT, getNonce: NONCE }));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
      ["/api/operations/done", { userOpHash: OP, transactionHash: TX, success: true }],
    ]);
    expect(passkey.sign).toHaveBeenCalledWith({ hash: "0xdead" });
  });

  it("refuses a passkey that isn't the account's, before anyone is asked to sign", async () => {
    wallet.createMemberAccount.mockResolvedValue({ address: getAddress("0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671") });
    const error = await sendCalls(me, CALLS, INFO).catch((caught) => caught);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toBe("Tu passkey no coincide con tu cuenta. Entrá de nuevo.");
    expect(wallet.sendTaggedCalls).not.toHaveBeenCalled();
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
    expect(error.message).toBe("La operación no se pudo completar. No se movió plata.");
    expect(posted().at(-1)).toEqual(["/api/operations/done", { userOpHash: OP, transactionHash: TX, success: false }]);
  });

  it("keeps trying to record an operation that is out, and never asks to send it again", async () => {
    // onSent fails (the server is down), then the receipt wait fails too: the error only names the hash.
    api.post.mockRejectedValueOnce(new UserFacingError("Algo falló. Probá de nuevo.")).mockResolvedValue({ ok: true });
    wallet.sendTaggedCalls.mockImplementation(async ({ onSent }) => {
      await onSent(OP).catch(() => {});
      throw new Error(`UserOperation ${OP} was sent but its receipt is unknown (timeout); its hash was not recorded`);
    });

    const error = await sendCalls(me, CALLS, INFO).catch((caught) => caught);

    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toMatch(/en camino/);
    expect(error.message).not.toMatch(/prob[aá] de nuevo/i);
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
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toMatch(/en camino/);
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
    expect(posted()).toEqual([["/api/operations/done", { userOpHash: OP, transactionHash: TX, success: false }]]);
  });

  it("says it's on its way, and records nothing, while the bundler has no receipt for it", async () => {
    bundler(null);
    const error = await settleOperation(OP).catch((caught) => caught);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toMatch(/en camino/);
    expect(api.post).not.toHaveBeenCalled();
  });
});
