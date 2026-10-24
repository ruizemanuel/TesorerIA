import { AGENT_ADDRESS, FUND_FACTORY, fundFactoryAbi } from "@tesoreria/agent";
import { keyChangeCallData } from "@tesoreria/wallet";
import { createFakePasskey } from "@tesoreria/wallet/testing";
import { eq } from "drizzle-orm";
import { type Address, type Hex, decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, numberToHex, toHex } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { contributeCalls } from "../src/lib/contribute";
import { acquireLock, releaseLock } from "../src/lib/db/lock";
import { credentials, operations } from "../src/lib/db/schema";
import { cancelDeploy, createDraft, deployCall, joinFund } from "../src/lib/funds";
import { es } from "../src/lib/i18n/es";
import { keyChangeLock } from "../src/lib/key-change";
import { LEGACY_RP_ID } from "../src/lib/passkey-sites";
import type { Session } from "../src/lib/session";
import { WARS, addLiveFund, addUser, randomAccount, testDb } from "./support/db";
import { type RpcOperation, entryPointHash } from "./support/entry-point";
import { safeCallData } from "./support/safe";
import { fakeSession } from "./support/session";

// The route as the server runs it, with the session and the database standing in, and Pimlico's answer faked.
const KEY = "pim_test_key_8b1f";
const POLICY = "sp_server_policy";
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  session: null as unknown,
  db: null as unknown,
  agentKeyIsWrong: false,
  recordFails: false,
  beforeLock: null as null | (() => Promise<void>),
}));
vi.mock("../src/lib/current-user", () => ({ currentUser: async () => state.user }));
vi.mock("../src/lib/session", () => ({ getSession: async () => state.session }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/operations", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/operations")>();
  return {
    ...real,
    // With `recordFails`, what a database that is down does.
    recordOperation: async (...args: Parameters<typeof real.recordOperation>) => {
      if (state.recordFails) throw new Error("the database is down");
      return real.recordOperation(...args);
    },
  };
});
vi.mock("../src/lib/db/lock", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/db/lock")>();
  return {
    ...real,
    // With `beforeLock`, what happens elsewhere while a request is on its way to the lock.
    withLock: async (...args: Parameters<typeof real.withLock>) => {
      await state.beforeLock?.();
      return real.withLock(...args);
    },
  };
});
vi.mock("../src/lib/agent-address", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/agent-address")>();
  return {
    // With `agentKeyIsWrong`, what the real one does on mainnet when AGENT_PRIVATE_KEY isn't AGENT_ADDRESS's key.
    agentAddress: () => {
      if (state.agentKeyIsWrong) throw new Error("AGENT_PRIVATE_KEY is not the key of AGENT_ADDRESS");
      return real.agentAddress();
    },
  };
});

const CELO = numberToHex(42220);
const FUND: Address = randomAccount(); // the member's live fund
/** An operation from `sender`: by default, contributing to the member's fund, as Aportar sends it. */
const op = (sender: string, callData: string = safeCallData(contributeCalls({ fund: FUND, token: "wars", amount: 10n ** 18n }))) => ({
  sender,
  nonce: "0x0",
  callData,
});
const rpc = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 5, method, params });

let POST: (request: Request) => Promise<Response>;
let recordRoute: (request: Request) => Promise<Response>;
let member: CurrentUser;
let stranger: CurrentUser;
const pimlico = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

beforeAll(async () => {
  vi.stubEnv("CHAIN_MODE", "mainnet");
  vi.stubEnv("RP_ID", "localhost");
  vi.stubEnv("ORIGIN", "http://localhost:3000");
  vi.stubEnv("SESSION_SECRET", "a-session-secret-for-tests-only-0123456789");
  vi.stubEnv("DATABASE_URL", "memory");
  vi.stubEnv("PIMLICO_API_KEY", KEY);
  vi.stubEnv("PIMLICO_SPONSORSHIP_POLICY_ID", POLICY);
  vi.stubEnv("AGENT_PRIVATE_KEY", ""); // so the server's agent is AGENT_ADDRESS, the one the createFunds below name
  const db: Db = await testDb();
  state.db = db;
  const ana = await addUser(db, "Ana");
  const outsider = await addUser(db, "Outsider");
  await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id] });
  member = { id: ana.id, name: ana.name, account: getAddress(ana.account) };
  stranger = { id: outsider.id, name: outsider.name, account: getAddress(outsider.account) };
  ({ POST } = await import("../src/app/api/bundler/route"));
  ({ POST: recordRoute } = await import("../src/app/api/operations/route"));
});
const FAST = 5_000_000_000n; // Pimlico's "fast" maxFeePerGas in these tests: 5 gwei
const priceAnswer = () => {
  const fee = { maxFeePerGas: numberToHex(FAST), maxPriorityFeePerGas: numberToHex(1_000_000_000n) };
  return Response.json({ jsonrpc: "2.0", id: 1, result: { slow: fee, standard: fee, fast: fee } });
};
/** The methods Pimlico was asked, in order. */
const asked = () => pimlico.mock.calls.map(([, init]) => (JSON.parse(init.body as string) as { method: string }).method);

beforeEach(() => {
  state.user = member;
  state.session = fakeSession(); // no key change ready
  vi.stubGlobal("fetch", pimlico);
  pimlico.mockImplementation(async (_url, init) =>
    (JSON.parse(init.body as string) as { method: string }).method === "pimlico_getUserOperationGasPrice"
      ? priceAnswer()
      : Response.json({ jsonrpc: "2.0", id: 5, result: CELO }),
  );
});
afterEach(() => {
  vi.clearAllMocks();
  state.agentKeyIsWrong = false;
  state.recordFails = false;
  state.beforeLock = null;
});

function call(body: unknown, contentType = "application/json") {
  return POST(new Request("http://localhost:3000/api/bundler", { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) }));
}

describe("POST /api/bundler", () => {
  it("answers 401 to someone who is not logged in, and asks Pimlico nothing", async () => {
    state.user = null;
    const response = await call(rpc("eth_chainId"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: 5, error: { message: "Log in first" } });
    expect(pimlico).not.toHaveBeenCalled();
  });

  it("answers 403 to a logged-in person who belongs to no fund, even for a request that is fine", async () => {
    state.user = stranger;
    const response = await call(rpc("eth_sendUserOperation", [op(stranger.account), entryPoint07Address]));
    expect(response.status).toBe(403);
    expect(pimlico).not.toHaveBeenCalled();
  });

  it("answers 403 and 400 to another account's operation, a method off the list, other chains and batches", async () => {
    const other = getAddress("0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671");
    const cases: [unknown, number][] = [
      [rpc("eth_sendUserOperation", [op(other), entryPoint07Address]), 403],
      [rpc("pm_getPaymasterData", [op(other), entryPoint07Address, CELO, {}]), 403],
      [rpc("eth_sendRawTransaction", ["0x00"]), 403],
      [rpc("pm_getPaymasterData", [op(member.account), entryPoint07Address, numberToHex(1), {}]), 400],
      [[rpc("eth_chainId"), rpc("eth_chainId")], 400],
    ];
    for (const [body, status] of cases) expect((await call(body)).status, JSON.stringify(body)).toBe(status);
    expect((await call("not a request")).status).toBe(400);
    expect(pimlico).not.toHaveBeenCalled();
  });

  it("sends a member's own request with the key, and with the server's policy instead of the one they sent", async () => {
    const response = await call(rpc("pm_getPaymasterStubData", [op(member.account), entryPoint07Address, CELO, { sponsorshipPolicyId: "sp_mine" }]));
    expect(response.status).toBe(200);
    expect(pimlico).toHaveBeenCalledTimes(1);
    const [url, init] = pimlico.mock.calls[0]!;
    expect(url).toBe(`https://api.pimlico.io/v2/42220/rpc?apikey=${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      jsonrpc: "2.0",
      id: 5,
      method: "pm_getPaymasterStubData",
      params: [op(member.account), entryPoint07Address, CELO, { sponsorshipPolicyId: POLICY }],
    });
  });

  it("answers 403 to a call the paymaster doesn't pay for, and asks Pimlico nothing", async () => {
    const transfer = safeCallData([{ to: FUND, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [stranger.account, 1n] }) }]);
    for (const method of ["eth_estimateUserOperationGas", "pm_getPaymasterStubData", "pm_getPaymasterData", "eth_sendUserOperation"]) {
      const params = method.startsWith("pm_") ? [op(member.account, transfer), entryPoint07Address, CELO, {}] : [op(member.account, transfer), entryPoint07Address];
      expect((await call(rpc(method, params))).status, method).toBe(403);
    }
    expect(pimlico).not.toHaveBeenCalled();
  });

  it("serves a member even when the agent's key is wrong: only a createFund needs the agent's address", async () => {
    state.agentKeyIsWrong = true;
    expect((await call(rpc("eth_chainId"))).status).toBe(200);
    expect((await call(rpc("pm_getPaymasterStubData", [op(member.account), entryPoint07Address, CELO, {}]))).status).toBe(200);
    expect(asked()).toEqual(["eth_chainId", "pm_getPaymasterStubData"]);
  });

  it("answers 502 to a paymaster stub that says it's final, and passes nothing of it on", async () => {
    pimlico.mockImplementation(async () =>
      Response.json({ jsonrpc: "2.0", id: 5, result: { paymaster: stranger.account, paymasterData: "0x5167", isFinal: true } }),
    );
    const response = await call(rpc("pm_getPaymasterStubData", [op(member.account), entryPoint07Address, CELO, {}]));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 5, error: { code: -32600, message: "The paymaster's stub must not be final" } });
  });

  describe("when the paymaster is about to sign", () => {
    const sponsored = (change: Record<string, unknown> = {}) => ({
      ...op(member.account),
      maxFeePerGas: numberToHex(2n * FAST),
      maxPriorityFeePerGas: numberToHex(1_000_000_000n),
      callGasLimit: numberToHex(1_000_000n), // 2M in all, the ceiling for anything but a createFund
      verificationGasLimit: numberToHex(900_000n),
      preVerificationGas: numberToHex(100_000n),
      ...change,
    });
    const sign = (userOp: unknown) => call(rpc("pm_getPaymasterData", [userOp, entryPoint07Address, CELO, { sponsorshipPolicyId: "sp_mine" }]));

    it("reads Pimlico's price with the key, and signs an operation that is within twice of it", async () => {
      expect((await sign(sponsored())).status).toBe(200);
      expect(asked()).toEqual(["pimlico_getUserOperationGasPrice", "pm_getPaymasterData"]);
      expect(pimlico.mock.calls.every(([url]) => url === `https://api.pimlico.io/v2/42220/rpc?apikey=${KEY}`)).toBe(true);
      expect(JSON.parse(pimlico.mock.calls[1]![1].body as string).params[3]).toEqual({ sponsorshipPolicyId: POLICY });
    });

    it("answers 400 to an operation that overpays or asks for too much gas, and signs nothing", async () => {
      for (const change of [{ maxFeePerGas: numberToHex(2n * FAST + 1n) }, { callGasLimit: numberToHex(10_000_000n) }, { callGasLimit: "lots" }]) {
        const response = await sign(sponsored(change));
        expect(response.status, JSON.stringify(change)).toBe(400);
      }
      expect(asked().filter((method) => method === "pm_getPaymasterData")).toEqual([]);
    });

    it("answers 502 and signs nothing when the price can't be read", async () => {
      const unreadable = [
        async () => Response.json({ error: { message: "down" } }, { status: 500 }),
        async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
        async () => {
          throw new TypeError(`fetch failed: https://api.pimlico.io/v2/42220/rpc?apikey=${KEY}`);
        },
      ];
      for (const answer of unreadable) {
        pimlico.mockImplementation(answer);
        const response = await sign(sponsored());
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain(KEY);
      }
      expect(pimlico).toHaveBeenCalledTimes(unreadable.length); // only ever the price
    });
  });

  describe("a createFund", () => {
    let creator: CurrentUser;
    /** The calldata deployCall built for each of the creator's two frozen drafts, and for one opened again since. */
    let futbol: Hex;
    let asado: Hex;
    let reopened: Hex;

    /** A draft `creatorId` made, with three more people, frozen by deployCall with 2 votes and the server's agent. */
    async function frozen(db: Db, creatorId: string, name: string) {
      const created = await createDraft(db, creatorId, { name, agreedExpense: "la cancha", weeklyFee: 10_000n * WARS, weeklyCap: 60_000n * WARS }, es);
      if (!created.ok) throw new Error(created.error);
      for (const person of ["Beto", "Caro", "Dani"]) await joinFund(db, (await addUser(db, person)).id, created.inviteCode, es);
      const deploy = await deployCall(db, { fundId: created.id, userId: creatorId, votesRequired: 2, agent: AGENT_ADDRESS, m: es });
      if (!deploy.ok) throw new Error(deploy.error);
      return { fundId: created.id, data: deploy.call.data };
    }

    beforeAll(async () => {
      const db = state.db as Db;
      const user = await addUser(db, "Creator");
      creator = { id: user.id, name: user.name, account: getAddress(user.account) };
      futbol = (await frozen(db, user.id, "Fútbol")).data;
      asado = (await frozen(db, user.id, "Asado")).data;
      const open = await frozen(db, user.id, "Cumple");
      await cancelDeploy(db, { fundId: open.fundId, userId: user.id, m: es });
      reopened = open.data;
    });

    /** The settings a createFund's data carries. */
    const createFundParams = (data: Hex) => {
      const decoded = decodeFunctionData({ abi: fundFactoryAbi, data });
      if (decoded.functionName !== "createFund") throw new Error(`Not a createFund: ${decoded.functionName}`);
      return decoded.args[0];
    };
    /** `data`'s createFund with one of its settings changed. */
    const changed = (data: Hex, change: Partial<ReturnType<typeof createFundParams>>): Hex =>
      encodeFunctionData({ abi: fundFactoryAbi, functionName: "createFund", args: [{ ...createFundParams(data), ...change }] });
    const stub = (data: Hex) =>
      call(rpc("pm_getPaymasterStubData", [op(creator.account, safeCallData([{ to: FUND_FACTORY, data }])), entryPoint07Address, CELO, {}]));

    it("sends on the exact call deployCall built for each draft its creator is creating", async () => {
      state.user = creator;
      for (const data of [futbol, asado]) expect((await stub(data)).status).toBe(200);
      expect(asked()).toEqual(["pm_getPaymasterStubData", "pm_getPaymasterStubData"]);
    });

    it("answers 403 to that call with another member, votes or agent, or for a draft open again, and asks Pimlico nothing", async () => {
      state.user = creator;
      const { members } = createFundParams(futbol);
      const cases: Record<string, Hex> = {
        "another member": changed(futbol, { members: [...members.slice(0, -1), randomAccount()] }),
        "another votesRequired": changed(futbol, { votesRequired: 3 }),
        "another agent": changed(futbol, { agent: randomAccount() }),
        "a draft open again": reopened,
      };
      for (const [why, data] of Object.entries(cases)) {
        const response = await stub(data);
        expect(response.status, why).toBe(403);
        expect(await response.json(), why).toMatchObject({ error: { message: expect.stringContaining("createFund") } });
      }
      expect(pimlico).not.toHaveBeenCalled();
    });

    it("refuses a createFund when the agent's address can't be read, and asks Pimlico nothing (M3)", async () => {
      state.user = creator;
      state.agentKeyIsWrong = true;
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await stub(futbol);
      expect(response.status).toBe(403);
      expect(pimlico).not.toHaveBeenCalled();
      logged.mockRestore();
    });
  });

  describe("a key change", () => {
    /** Someone in no fund, with the old site's passkey active and a new one pending. */
    let changer: CurrentUser;
    let pending: Hex;
    let pendingId: string;
    const SENT: Hex = `0x${"5e".repeat(32)}`; // the hash Pimlico gives the operation it accepts

    beforeAll(async () => {
      const db = state.db as Db;
      const user = await addUser(db, "Changer");
      changer = { id: user.id, name: user.name, account: getAddress(user.account) };
      const old = createFakePasskey({ rpId: LEGACY_RP_ID });
      const fresh = createFakePasskey({ rpId: "tesoreria.finance" });
      const userHandle = toHex(crypto.getRandomValues(new Uint8Array(16)));
      await db.insert(credentials).values([
        { id: old.credential.id, userId: user.id, publicKey: old.credential.publicKey, userHandle, rpId: LEGACY_RP_ID },
        { id: fresh.credential.id, userId: user.id, publicKey: fresh.credential.publicKey, userHandle, rpId: "tesoreria.finance", state: "pending" },
      ]);
      pending = fresh.credential.publicKey;
      pendingId = fresh.credential.id;
    });

    /** The changer's session, which made or proved the passkey `keyChange` names (the pending one, by default), or none. */
    function sessionFor(keyChange: string | null = pendingId): Session {
      const session = fakeSession();
      session.userId = changer.id;
      session.keyChange = keyChange ?? undefined;
      return session;
    }
    /** A key change operation from `sender` (the changer, by default), as their page signs it, with `change` made to it. */
    const operation = (callData: Hex, change: Record<string, unknown> = {}, sender: Address = changer.account) =>
      ({
        ...op(sender, callData),
        maxFeePerGas: numberToHex(2n * FAST),
        maxPriorityFeePerGas: numberToHex(1_000_000_000n),
        callGasLimit: numberToHex(1_000_000n),
        verificationGasLimit: numberToHex(900_000n),
        preVerificationGas: numberToHex(100_000n),
        ...change,
      }) as RpcOperation;
    const send = (method: string, callData: Hex, change: Record<string, unknown> = {}, sender?: Address) => {
      const userOp = operation(callData, change, sender);
      return call(rpc(method, method.startsWith("pm_") ? [userOp, entryPoint07Address, CELO, {}] : [userOp, entryPoint07Address]));
    };
    /** Another nonce for each operation, so that no two tests send the same one. */
    let nonces = 0;
    const fresh = () => ({ nonce: numberToHex(++nonces) });
    /** The hash EntryPoint v0.7 gives the changer's key change to `key` with `change`: the one a bundler answers with. */
    const hashOf = (key: Hex, change: Record<string, unknown>) => entryPointHash(operation(keyChangeCallData(key), change));
    /** What a bundler answers a send it takes, and one it refuses. */
    const accepting = (hash: Hex) => async () => Response.json({ jsonrpc: "2.0", id: 5, result: hash });
    const refusing = (message: string) => async () => Response.json({ jsonrpc: "2.0", id: 5, error: { code: -32500, message } });
    const SPONSORED = ["pm_getPaymasterStubData", "eth_estimateUserOperationGas", "pm_getPaymasterData", "eth_sendUserOperation"];
    /** The key change operations the database keeps under this hash. */
    const recorded = (userOpHash: Hex) => (state.db as Db).select().from(operations).where(eq(operations.userOpHash, userOpHash));

    it("sponsors the key change to this session's pending key, for someone in no fund", async () => {
      state.user = changer;
      state.session = sessionFor();
      for (const method of SPONSORED) expect((await send(method, keyChangeCallData(pending))).status, method).toBe(200);
      expect(asked()).toEqual([...SPONSORED.slice(0, 2), "pimlico_getUserOperationGasPrice", ...SPONSORED.slice(2)]);
      // Held to the 2M ceiling of anything that isn't a createFund.
      expect((await send("pm_getPaymasterData", keyChangeCallData(pending), { callGasLimit: numberToHex(1_000_001n) })).status).toBe(400);
    });

    it("refuses a key change to any other key", async () => {
      state.user = changer;
      state.session = sessionFor();
      for (const key of [createFakePasskey().credential.publicKey, createFakePasskey({ rpId: LEGACY_RP_ID }).credential.publicKey]) {
        for (const method of SPONSORED) {
          const response = await send(method, keyChangeCallData(key));
          expect(response.status, method).toBe(403);
          expect(await response.json()).toMatchObject({ error: { message: "Only a key change to the passkey this session made or proved is sponsored" } });
        }
      }
      // Nor a member of a live fund to theirs: what their funds let them do has nothing to do with it.
      state.user = member;
      expect((await call(rpc("eth_sendUserOperation", [op(member.account, keyChangeCallData(pending)), entryPoint07Address]))).status).toBe(403);
      expect(pimlico).not.toHaveBeenCalled();
    });

    it("refuses a key change when this session hasn't made or proved the pending passkey", async () => {
      state.user = changer;
      for (const session of [sessionFor(null), sessionFor("another-passkey")]) {
        state.session = session;
        for (const method of SPONSORED) expect((await send(method, keyChangeCallData(pending))).status, `${method}: ${session.keyChange}`).toBe(403);
        expect((await call(rpc("eth_getUserOperationReceipt", [SENT]))).status).toBe(403); // and, in no fund, nothing to read
      }
      expect(pimlico).not.toHaveBeenCalled();
    });

    it("sponsors nothing, not even a read, toward a pending passkey of the old site, though this session made it", async () => {
      // What a crafted start on a deployment still on the old site would leave: two passkeys of that site.
      const db = state.db as Db;
      const user = await addUser(db, "Disposable");
      const [old, second] = [createFakePasskey({ rpId: LEGACY_RP_ID }), createFakePasskey({ rpId: LEGACY_RP_ID })];
      await db.insert(credentials).values([
        { id: old.credential.id, userId: user.id, publicKey: old.credential.publicKey, userHandle: toHex(crypto.getRandomValues(new Uint8Array(16))), rpId: LEGACY_RP_ID },
        {
          id: second.credential.id,
          userId: user.id,
          publicKey: second.credential.publicKey,
          userHandle: toHex(crypto.getRandomValues(new Uint8Array(16))),
          rpId: LEGACY_RP_ID,
          state: "pending",
        },
      ]);
      state.user = { id: user.id, name: user.name, account: getAddress(user.account) };
      const session = fakeSession();
      session.userId = user.id;
      session.keyChange = second.credential.id;
      state.session = session;
      const userOp = op(user.account, keyChangeCallData(second.credential.publicKey));
      for (const method of SPONSORED) {
        const params = method.startsWith("pm_") ? [userOp, entryPoint07Address, CELO, {}] : [userOp, entryPoint07Address];
        expect((await call(rpc(method, params))).status, method).toBe(403);
      }
      expect((await call(rpc("eth_getUserOperationReceipt", [SENT]))).status).toBe(403);
      expect(pimlico).not.toHaveBeenCalled();
    });

    it("lets someone with a key change on its way read receipts", async () => {
      state.user = changer;
      state.session = sessionFor();
      for (const method of ["eth_getUserOperationReceipt", "eth_getUserOperationByHash"]) expect((await call(rpc(method, [SENT]))).status, method).toBe(200);
      expect((await call(rpc("eth_chainId"))).status).toBe(200);
      expect(asked()).toEqual(["eth_getUserOperationReceipt", "eth_getUserOperationByHash", "eth_chainId"]);
    });

    it("records the key change before it goes out, under the hash the bundler answers, and the page's own record of it changes nothing", async () => {
      state.user = changer;
      state.session = sessionFor();
      const change = fresh();
      const hash = hashOf(pending, change);
      let whenSent: unknown[] = [];
      pimlico.mockImplementation(async () => {
        whenSent = await recorded(hash); // what the database had as the bundler got it
        return accepting(hash)();
      });
      expect(await (await send("eth_sendUserOperation", keyChangeCallData(pending), change)).json()).toEqual({ jsonrpc: "2.0", id: 5, result: hash });
      const row = { userOpHash: hash, userId: changer.id, kind: "key-change", fund: null, success: null, transactionHash: null };
      expect(whenSent).toEqual([expect.objectContaining(row)]);
      expect(await recorded(hash)).toEqual([expect.objectContaining(row)]);

      // The page records the hash viem gave it, as it does every operation: the same row, kept once.
      const posted = await recordRoute(
        new Request("http://localhost:3000/api/operations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userOpHash: hash, kind: "key-change" }),
        }),
      );
      expect(posted.status).toBe(200);
      expect(await recorded(hash)).toEqual([expect.objectContaining(row)]);
    });

    it("marks the key change failed when the bundler refuses it, and records nothing else", async () => {
      state.user = changer;
      state.session = sessionFor();
      const change = fresh();
      pimlico.mockImplementation(refusing("AA23 reverted"));
      const response = await send("eth_sendUserOperation", keyChangeCallData(pending), change);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ error: { message: "AA23 reverted" } }); // the bundler's answer, as it came
      expect(await recorded(hashOf(pending, change))).toEqual([expect.objectContaining({ kind: "key-change", success: false })]);
      // Estimating or stubbing it records nothing; nor does a member's contribution, which is the page's to record.
      for (const method of ["pm_getPaymasterStubData", "eth_estimateUserOperationGas"]) {
        const estimated = fresh();
        pimlico.mockImplementation(accepting(hashOf(pending, estimated)));
        expect((await send(method, keyChangeCallData(pending), estimated)).status, method).toBe(200);
        expect(await recorded(hashOf(pending, estimated)), method).toEqual([]);
      }
      state.user = member;
      expect((await call(rpc("eth_sendUserOperation", [op(member.account), entryPoint07Address]))).status).toBe(200);
      expect(await (state.db as Db).select().from(operations).where(eq(operations.userId, member.id))).toEqual([]);
    });

    it("leaves a refused key change open when the same operation had gone out before: that one may land", async () => {
      state.user = changer;
      state.session = sessionFor();
      const change = fresh();
      const hash = hashOf(pending, change);
      // Its first send reached the bundler but its answer never came back; the page sends it again, and the bundler knows it.
      await (state.db as Db).insert(operations).values({ userOpHash: hash, userId: changer.id, kind: "key-change" });
      pimlico.mockImplementation(refusing("AA25 invalid account nonce"));
      expect((await send("eth_sendUserOperation", keyChangeCallData(pending), change)).status).toBe(200);
      expect(await recorded(hash)).toEqual([expect.objectContaining({ success: null })]);
    });

    it("leaves the key change open when the bundler doesn't answer, or a gateway fails: it may have gone in", async () => {
      state.user = changer;
      state.session = sessionFor();
      const lost = fresh();
      pimlico.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      expect((await send("eth_sendUserOperation", keyChangeCallData(pending), lost)).status).toBe(502);
      expect(await recorded(hashOf(pending, lost))).toEqual([expect.objectContaining({ success: null })]);

      const gateway = fresh();
      pimlico.mockImplementation(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
      expect((await send("eth_sendUserOperation", keyChangeCallData(pending), gateway)).status).toBe(502);
      expect(await recorded(hashOf(pending, gateway))).toEqual([expect.objectContaining({ success: null })]);
    });

    it("sends nothing it can't record first", async () => {
      state.user = changer;
      state.session = sessionFor();
      state.recordFails = true;
      const change = fresh();
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await send("eth_sendUserOperation", keyChangeCallData(pending), change);
      expect(response.status).toBe(503);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("the database is down"));
      logged.mockRestore();
      expect(pimlico).not.toHaveBeenCalled();
      expect(await recorded(hashOf(pending, change))).toEqual([]);
    });

    it("sends nothing while a start of theirs, or another send, holds their key change's lock", async () => {
      state.user = changer;
      state.session = sessionFor();
      const db = state.db as Db;
      const change = fresh();
      expect(await acquireLock(db, keyChangeLock(changer.id), "a start on another phone", 60_000)).toBe(true);
      const refused = await send("eth_sendUserOperation", keyChangeCallData(pending), change);
      expect(refused.status).toBe(503);
      expect(pimlico).not.toHaveBeenCalled();
      expect(await recorded(hashOf(pending, change))).toEqual([]);

      // Free again, the same send goes out.
      await releaseLock(db, keyChangeLock(changer.id), "a start on another phone");
      pimlico.mockImplementation(accepting(hashOf(pending, change)));
      expect((await send("eth_sendUserOperation", keyChangeCallData(pending), change)).status).toBe(200);
      expect(await recorded(hashOf(pending, change))).toHaveLength(1);
    });

    it("sends nothing when the pending passkey went while the send waited for the lock", async () => {
      // A start on another phone held the lock and replaced the pending passkey: this session's swap is to a key nobody keeps.
      const db = state.db as Db;
      const user = await addUser(db, "Two phones");
      const [old, replaced] = [createFakePasskey({ rpId: LEGACY_RP_ID }), createFakePasskey({ rpId: "tesoreria.finance" })];
      const userHandle = toHex(crypto.getRandomValues(new Uint8Array(16)));
      await db.insert(credentials).values([
        { id: old.credential.id, userId: user.id, publicKey: old.credential.publicKey, userHandle, rpId: LEGACY_RP_ID },
        { id: replaced.credential.id, userId: user.id, publicKey: replaced.credential.publicKey, userHandle, rpId: "tesoreria.finance", state: "pending" },
      ]);
      const account = getAddress(user.account);
      state.user = { id: user.id, name: user.name, account };
      const session = fakeSession();
      session.userId = user.id;
      session.keyChange = replaced.credential.id;
      state.session = session;
      state.beforeLock = async () => {
        await db.delete(credentials).where(eq(credentials.id, replaced.credential.id));
      };
      const response = await send("eth_sendUserOperation", keyChangeCallData(replaced.credential.publicKey), fresh(), account);
      expect(response.status).toBe(403);
      expect(pimlico).not.toHaveBeenCalled();
      expect(await db.select().from(operations).where(eq(operations.userId, user.id))).toEqual([]);
    });
  });

  it("never lets the key out, in an answer or in a failure", async () => {
    const ok = await call(rpc("eth_chainId"));
    expect(JSON.stringify([...ok.headers])).not.toContain(KEY);
    expect(await ok.text()).not.toContain(KEY);

    pimlico.mockRejectedValue(new TypeError(`fetch failed: https://api.pimlico.io/v2/42220/rpc?apikey=${KEY}`));
    const failed = await call(rpc("eth_chainId"));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain(KEY);
  });
});
