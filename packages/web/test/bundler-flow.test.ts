import { AGENT_ADDRESS, FUND_FACTORY } from "@tesoreria/agent";
import { ATTRIBUTION_SUFFIX, type Call, createMemberAccount, createPimlicoBundlerClient } from "@tesoreria/wallet";
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
  numberToHex,
  pad,
  parseAbi,
  toFunctionSelector,
} from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { describe, expect, it } from "vitest";
import { authorizeBundlerRequest } from "../src/lib/bundler-proxy";
import { contributeCalls } from "../src/lib/contribute";
import { createDraft, deployCall, joinFund } from "../src/lib/funds";
import { voteCalls } from "../src/lib/vote";
import { WARS, addLiveFund, addUser, randomAccount, testDb } from "./support/db";

const POLICY = "sp_server";
const FAST = 5_000_000_000n;
const OP: Hash = pad("0x01", { size: 32 });
const PAYMASTER: Address = getAddress("0x00000000000000000000000000000000000fa575");
const fee = { maxFeePerGas: numberToHex(FAST), maxPriorityFeePerGas: numberToHex(1_000_000_000n) };

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

describe("the requests viem really sends for a sponsored operation", () => {
  it("all get through the gate for every call the web makes, each as the member's own, with the server's policy", async () => {
    const client = createPublicClient({ chain: celo, transport: node });
    const passkey = createFakePasskey();
    const account = await createMemberAccount({ client, owner: toWebAuthnAccount({ ...passkey, rpId: "localhost" }) });

    // Ana is creating a fund (deployCall froze it), and is in a live one: every call she can make is hers to make.
    const db = await testDb();
    const ana = await addUser(db, "Ana", account.address);
    const draft = await createDraft(db, ana.id, { name: "Fútbol", agreedExpense: "la cancha", weeklyFee: 10_000n * WARS, weeklyCap: 60_000n * WARS });
    if (!draft.ok) throw new Error(draft.error);
    for (const name of ["Beto", "Caro"]) await joinFund(db, (await addUser(db, name)).id, draft.inviteCode);
    const deploy = await deployCall(db, { fundId: draft.id, userId: ana.id, votesRequired: 2, agent: AGENT_ADDRESS });
    if (!deploy.ok) throw new Error(deploy.error);
    const fund = randomAccount();
    await addLiveFund(db, { creatorId: ana.id, address: fund, members: [ana.id] });
    const user = { id: ana.id, account: account.address };

    const forwarded: { method: string; params: unknown[] }[] = [];
    // /api/bundler without the HTTP: each request is checked as the route checks it, and answered as Pimlico would.
    const gate = custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        const check = await authorizeBundlerRequest(db, user, { jsonrpc: "2.0", id: 1, method, params }, POLICY, async () => FAST, AGENT_ADDRESS);
        if (!check.ok) throw new Error(`${method}: ${check.status} ${check.error}`);
        forwarded.push({ method, params: check.request.params });
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
        }
        throw new Error(`unexpected bundler RPC: ${method}`);
      },
    });
    const bundler = createPimlicoBundlerClient({ client, transport: gate, sponsorshipPolicyId: "set by the server" });

    // Every call shape the web sends: deploy-form's createFund, Aportar's two, and VoteButton's two (lib/vote.ts).
    const shapes: Record<string, Call[]> = {
      createFund: [deploy.call],
      "contribute wARS": contributeCalls({ fund, token: "wars", amount: 10_000n * WARS }),
      "contribute USDT": contributeCalls({ fund, token: "usdt", amount: 10_000_000n }),
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
      const withOperation = forwarded.filter(({ params }) => typeof params[0] === "object" && params[0] !== null);
      expect(
        withOperation.map(({ method }) => method),
        shape,
      ).toEqual(["pm_getPaymasterStubData", "eth_estimateUserOperationGas", "pm_getPaymasterData", "eth_sendUserOperation"]);
      for (const { method, params } of withOperation) {
        expect((params[0] as { callData: string }).callData.endsWith(ATTRIBUTION_SUFFIX.slice(2)), `${shape}, ${method}`).toBe(true);
      }
    }
    // A createFund on the key viem would pick by itself isn't one the gate counts, so it never gets through.
    await expect(bundler.sendUserOperation({ account, calls: [deploy.call] })).rejects.toThrow("403 A createFund is sponsored only on EntryPoint nonce key 0");
  });
});
