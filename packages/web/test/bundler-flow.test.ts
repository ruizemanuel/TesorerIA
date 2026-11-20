import { AGENT_ADDRESS, FUND_FACTORY, USDT, WARS as WARS_TOKEN } from "@tesoreria/agent";
import { ATTRIBUTION_SUFFIX, type Call, createMemberAccount, createPimlicoBundlerClient, keyChangeCallData, sendKeyChange } from "@tesoreria/wallet";
import { createFakePasskey } from "@tesoreria/wallet/testing";
import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  http,
  isAddress,
  numberToHex,
  pad,
  parseAbi,
  toFunctionSelector,
} from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeBundlerRequest, userOperationHash } from "../src/lib/bundler-proxy";
import { contributeCalls } from "../src/lib/contribute";
import type { Db } from "../src/lib/db/client";
import { userMessage } from "../src/lib/client/errors";
import { createDraft, deployCall, joinFund } from "../src/lib/funds";
import { voteCalls } from "../src/lib/vote";
import { WARS, addLiveFund, addUser, randomAccount, testDb } from "./support/db";
import { type RpcOperation, entryPointHash } from "./support/entry-point";
import { es } from "./support/messages";

const POLICY = "sp_server";
const FAST = 5_000_000_000n;
const OP: Hash = pad("0x01", { size: 32 });
const PAYMASTER: Address = getAddress("0x00000000000000000000000000000000000fa575");
const fee = { maxFeePerGas: numberToHex(FAST), maxPriorityFeePerGas: numberToHex(1_000_000_000n) };
/** The operations the sponsored flow sends, in the order viem sends them. */
const WITH_OPERATION = ["pm_getPaymasterStubData", "eth_estimateUserOperationGas", "pm_getPaymasterData", "eth_sendUserOperation"];

const PROXY_CREATION_CODE = toFunctionSelector("proxyCreationCode()");
const entryPointNonceAbi = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256)"]);

/** Celo's node, as little of it as a counterfactual Safe's first operation reads. */
const node = custom({
  async request({ method, params }: { method: string; params?: unknown }) {
    if (method === "eth_chainId") return numberToHex(celo.id);
    if (method === "eth_getCode") return "0x"; // not deployed yet
    if (method === "eth_call") {
      const { data } = (params as [{ data: Hex }])[0];
      // The factory's proxy bytecode: any bytes will do, only the account's address depends on it.
      if (data.startsWith(PROXY_CREATION_CODE)) return encodeAbiParameters([{ type: "bytes" }], ["0x6080"]);
      // The EntryPoint's nonce for an account that never sent an operation: the key asked for, sequence 0.
      const { args } = decodeFunctionData({ abi: entryPointNonceAbi, data });
      return encodeAbiParameters([{ type: "uint256" }], [args[1] << 64n]);
    }
    throw new Error(`unexpected node RPC: ${method}`);
  },
});

type Forwarded = { method: string; params: unknown[] };

/** What Pimlico answers to `method` when it sponsors the operation. */
function sponsoring(method: string, params: unknown) {
  const creating = JSON.stringify(params).toLowerCase().includes(FUND_FACTORY.slice(2).toLowerCase());
  switch (method) {
    case "eth_chainId":
      return numberToHex(celo.id);
    case "pimlico_getUserOperationGasPrice":
      return { slow: fee, standard: fee, fast: fee };
    case "pm_getPaymasterStubData":
      return {
        paymaster: PAYMASTER,
        paymasterData: "0x",
        paymasterVerificationGasLimit: numberToHex(40_000n),
        paymasterPostOpGasLimit: numberToHex(30_000n),
      };
    case "eth_estimateUserOperationGas":
      return {
        callGasLimit: numberToHex(creating ? 5_000_000n : 300_000n), // createFund deploys a whole Fund
        verificationGasLimit: numberToHex(700_000n),
        preVerificationGas: numberToHex(80_000n),
        paymasterVerificationGasLimit: numberToHex(40_000n),
        paymasterPostOpGasLimit: numberToHex(30_000n),
      };
    case "pm_getPaymasterData":
      return { paymaster: PAYMASTER, paymasterData: "0x" };
    case "eth_sendUserOperation":
      return OP;
    case "eth_getUserOperationReceipt":
      return { userOpHash: OP, success: true, receipt: { transactionHash: pad("0x02", { size: 32 }), blockNumber: numberToHex(79_700_001n) } };
  }
  throw new Error(`unexpected bundler RPC: ${method}`);
}

/**
 * /api/bundler without the HTTP, for `user`: each request is checked as the route checks it, kept in `forwarded`
 * once it passes, and answered as Pimlico would.
 */
function gate(db: Db, user: Parameters<typeof authorizeBundlerRequest>[1], forwarded: Forwarded[]) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const check = await authorizeBundlerRequest(db, user, { jsonrpc: "2.0", id: 1, method, params }, POLICY, async () => FAST, () => AGENT_ADDRESS, 10);
      if (!check.ok) throw new Error(`${method}: ${check.status} ${check.error}`);
      forwarded.push({ method, params: check.request.params });
      return sponsoring(method, params);
    },
  });
}

/** The requests in `forwarded` that carry an operation, which the paymaster pays for. */
const withOperation = (forwarded: Forwarded[]) => forwarded.filter(({ params }) => typeof params[0] === "object" && params[0] !== null);

describe("the requests viem really sends for a sponsored operation", () => {
  it("all get through the gate for every call the web makes, each as the member's own, with the server's policy", async () => {
    const client = createPublicClient({ chain: celo, transport: node });
    const passkey = createFakePasskey();
    const account = await createMemberAccount({ client, owner: toWebAuthnAccount({ ...passkey, rpId: "localhost" }) });

    // Ana is creating a fund (deployCall froze it), and is in a live one: every call she can make is hers to make.
    const db = await testDb();
    const ana = await addUser(db, "Ana", account.address);
    const draft = await createDraft(db, ana.id, { name: "Fútbol", agreedExpense: "la cancha", weeklyFee: 10_000n * WARS, weeklyCap: 60_000n * WARS }, es);
    if (!draft.ok) throw new Error(draft.error);
    for (const name of ["Beto", "Caro"]) await joinFund(db, (await addUser(db, name)).id, draft.inviteCode, es);
    const deploy = await deployCall(db, { fundId: draft.id, userId: ana.id, votesRequired: 2, agent: AGENT_ADDRESS, m: es });
    if (!deploy.ok) throw new Error(deploy.error);
    const fund = randomAccount();
    await addLiveFund(db, { creatorId: ana.id, address: fund, members: [ana.id] });
    const fundV2 = randomAccount();
    await addLiveFund(db, { creatorId: ana.id, address: fundV2, members: [ana.id], version: 2 });
    const user = { id: ana.id, account: account.address, keyChangeKey: null };

    const forwarded: Forwarded[] = [];
    const bundler = createPimlicoBundlerClient({ client, transport: gate(db, user, forwarded), sponsorshipPolicyId: "set by the server" });

    // Every call shape the web sends: deploy-form's createFund, Aportar's two on each version, and VoteButton's two (lib/vote.ts).
    const shapes: Record<string, Call[]> = {
      createFund: [deploy.call],
      "contribute wARS": contributeCalls({ fund, version: 1, token: "wars", amount: 10_000n * WARS, currency: WARS_TOKEN, dollar: USDT }),
      "contribute USDT": contributeCalls({ fund, version: 1, token: "usdt", amount: 10_000_000n, currency: WARS_TOKEN, dollar: USDT }),
      "contribute to a v2 fund": contributeCalls({ fund: fundV2, version: 2, token: "wars", amount: 10_000n * WARS, currency: WARS_TOKEN, dollar: USDT }),
      "contributeDollar to a v2 fund": contributeCalls({ fund: fundV2, version: 2, token: "usdt", amount: 10_000_000n, currency: WARS_TOKEN, dollar: USDT }),
      "vote on a v2 fund": voteCalls({ fund: fundV2, proposalId: 0n, completes: false }),
      vote: voteCalls({ fund, proposalId: 0n, completes: false }),
      "vote and execute": voteCalls({ fund, proposalId: 0n, completes: true }),
    };
    for (const [shape, calls] of Object.entries(shapes)) {
      forwarded.length = 0;
      // As the web sends them (client/wallet.ts): a createFund on nonce key 0, anything else on a fresh key viem picks.
      const nonce = shape === "createFund" ? await account.getNonce!({ key: 0n }) : undefined;
      expect(await bundler.sendUserOperation({ account, calls, nonce }), shape).toBe(OP);

      expect(forwarded.at(-1)?.method, shape).toBe("eth_sendUserOperation");
      for (const { method, params } of forwarded.filter(({ method }) => method.startsWith("pm_"))) {
        expect(params[3], `${shape}, ${method}`).toEqual({ sponsorshipPolicyId: POLICY });
      }
      // viem tags the callData before it asks for anything, so the estimate and the stub carry the tag too.
      expect(
        withOperation(forwarded).map(({ method }) => method),
        shape,
      ).toEqual(WITH_OPERATION);
      for (const { method, params } of withOperation(forwarded)) {
        expect((params[0] as { callData: string }).callData.endsWith(ATTRIBUTION_SUFFIX.slice(2)), `${shape}, ${method}`).toBe(true);
      }
    }
    // A createFund on the key viem would pick by itself isn't one the gate counts, so it never gets through.
    await expect(bundler.sendUserOperation({ account, calls: [deploy.call] })).rejects.toThrow("403 A createFund is sponsored only on EntryPoint nonce key 0");
  });

  it("the key change viem really sends gets through, for a Safe not yet deployed", async () => {
    const client = createPublicClient({ chain: celo, transport: node });
    const active = createFakePasskey();
    const account = await createMemberAccount({ client, owner: toWebAuthnAccount({ ...active, rpId: "localhost" }) });
    const db = await testDb();
    const ema = await addUser(db, "Ema", account.address); // in no fund, creating none
    const pending = createFakePasskey().credential.publicKey;
    const forwarded: Forwarded[] = [];
    const bundlerFor = (keyChangeKey: Hex | null) =>
      createPimlicoBundlerClient({ client, transport: gate(db, { id: ema.id, account: account.address, keyChangeKey }, forwarded), sponsorshipPolicyId: "set by the server" });

    // As the page sends it: through sendKeyChange, with the client the page uses, and waiting for its receipt.
    const result = await sendKeyChange({ bundlerClient: bundlerFor(pending), account, publicKey: pending, timeout: 5_000 });
    expect(result).toMatchObject({ userOpHash: OP, success: true });

    expect(withOperation(forwarded).map(({ method }) => method)).toEqual(WITH_OPERATION);
    for (const { method, params } of withOperation(forwarded)) {
      const userOp = params[0] as { callData: Hex; factory?: Address; factoryData?: Hex };
      expect(userOp.callData, method).toBe(keyChangeCallData(pending)); // the tag once: what the gate decodes is what viem sends
      // The first operation deploys the Safe, with its old key, before it changes it.
      expect(isAddress(userOp.factory ?? "", { strict: false }), method).toBe(true);
      expect(userOp.factoryData?.length, method).toBeGreaterThan(2);
      if (method.startsWith("pm_")) expect(params[3], method).toEqual({ sponsorshipPolicyId: POLICY });
    }
    expect(forwarded.map(({ method }) => method)).toContain("eth_getUserOperationReceipt"); // read in no fund
    // What /api/bundler records it under before it goes out is EntryPoint v0.7's hash of the operation viem really sends.
    const sent = forwarded.find(({ method }) => method === "eth_sendUserOperation")?.params[0] as RpcOperation;
    expect(sent.paymaster).toBe(PAYMASTER);
    expect(userOperationHash(sent)).toBe(entryPointHash(sent));

    // The same to a key this session didn't make or prove, or with no key change ready (not even a read then): nothing goes out.
    forwarded.length = 0;
    const other = createFakePasskey().credential.publicKey;
    await expect(sendKeyChange({ bundlerClient: bundlerFor(pending), account, publicKey: other, timeout: 5_000 })).rejects.toThrow(
      "403 Only a key change to the passkey this session made or proved is sponsored",
    );
    await expect(sendKeyChange({ bundlerClient: bundlerFor(null), account, publicKey: pending, timeout: 5_000 })).rejects.toThrow(
      "403 Only members of a fund use the bundler",
    );
    expect(withOperation(forwarded)).toEqual([]);
  });
});

describe("a vote the paymaster's policy refuses for its cap per account", () => {
  afterEach(() => vi.unstubAllGlobals());

  // What Pimlico answered to every pm_getPaymasterData of the account on 14/11/2026 (its request logs), which
  // /api/bundler passes on as it came. The HTTP status isn't in the logs, so both a 200 and a 400 are tried.
  for (const status of [200, 400]) {
    it(`tells the person, without asking for the passkey or sending anything (HTTP ${status})`, async () => {
      const client = createPublicClient({ chain: celo, transport: node });
      const passkey = toWebAuthnAccount({ ...createFakePasskey(), rpId: "localhost" });
      let signatures = 0;
      const owner: typeof passkey = {
        ...passkey,
        async sign(parameters) {
          signatures++;
          return passkey.sign(parameters);
        },
      };
      const account = await createMemberAccount({ client, owner });
      const asked: string[] = [];
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        const { id, method, params } = JSON.parse(init.body as string) as { id: number; method: string; params: unknown };
        asked.push(method);
        if (method === "pm_getPaymasterData") {
          return Response.json({ id, error: { code: -32602, message: "sponsorshipPolicy perUserMaximumOpCount reached" }, jsonrpc: "2.0" }, { status });
        }
        return Response.json({ jsonrpc: "2.0", id, result: sponsoring(method, params) });
      });
      // As the page makes it (memberBundlerClient): Pimlico's client, over HTTP to /api/bundler.
      const bundler = createPimlicoBundlerClient({ client, transport: http("https://tesoreria.test/api/bundler"), sponsorshipPolicyId: "set by the server" });

      const caught = await bundler
        .sendUserOperation({ account, calls: voteCalls({ fund: randomAccount(), proposalId: 0n, completes: false }) })
        .catch((error: unknown) => error);

      expect(userMessage(caught, es)).toBe("Tu cuenta llegó al tope de operaciones que paga TesorerIA este mes. No se movió plata. Escribinos y lo destrabamos.");
      expect(asked).toContain("pm_getPaymasterData");
      expect(asked).not.toContain("eth_sendUserOperation");
      expect(signatures).toBe(0);
    });
  }
});
