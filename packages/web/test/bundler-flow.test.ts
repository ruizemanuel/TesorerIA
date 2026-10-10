import { ATTRIBUTION_SUFFIX, createMemberAccount, createPimlicoBundlerClient } from "@tesoreria/wallet";
import { createFakePasskey } from "@tesoreria/wallet/testing";
import { type Address, type Hash, createPublicClient, custom, encodeAbiParameters, getAddress, numberToHex, pad, toFunctionSelector } from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { describe, expect, it } from "vitest";
import { checkBundlerRequest, checkSponsoredGas } from "../src/lib/bundler-proxy";

const POLICY = "sp_server";
const FAST = 5_000_000_000n;
const OP: Hash = pad("0x01", { size: 32 });
const PAYMASTER: Address = getAddress("0x00000000000000000000000000000000000fa575");
const fee = { maxFeePerGas: numberToHex(FAST), maxPriorityFeePerGas: numberToHex(1_000_000_000n) };

const PROXY_CREATION_CODE = toFunctionSelector("proxyCreationCode()");

/** Celo's node, as little of it as a counterfactual Safe's first operation reads. */
const node = custom({
  async request({ method, params }: { method: string; params?: unknown }) {
    if (method === "eth_chainId") return numberToHex(celo.id);
    if (method === "eth_getCode") return "0x"; // not deployed yet
    if (method === "eth_call") {
      const { data } = (params as [{ data: string }])[0];
      // The factory's proxy bytecode (any bytes will do: only the account's address depends on it), else the EntryPoint's nonce.
      return data.startsWith(PROXY_CREATION_CODE) ? encodeAbiParameters([{ type: "bytes" }], ["0x6080"]) : pad("0x00", { size: 32 });
    }
    throw new Error(`unexpected node RPC: ${method}`);
  },
});

describe("the requests viem really sends for a sponsored operation", () => {
  it("all get through the gate, each as the logged-in member's own, with the server's policy", async () => {
    const client = createPublicClient({ chain: celo, transport: node });
    const passkey = createFakePasskey();
    const account = await createMemberAccount({ client, owner: toWebAuthnAccount({ ...passkey, rpId: "localhost" }) });
    const forwarded: { method: string; params: unknown[] }[] = [];

    // /api/bundler without the HTTP: each request is checked as the route checks it, and answered as Pimlico would.
    const gate = custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        const check = checkBundlerRequest({ jsonrpc: "2.0", id: 1, method, params }, account.address, POLICY);
        if (!check.ok) throw new Error(`${method}: ${check.status} ${check.error}`);
        if (method === "pm_getPaymasterData") {
          const gas = checkSponsoredGas(check.request.params[0], FAST);
          if (!gas.ok) throw new Error(`${method}: ${gas.status} ${gas.error}`);
        }
        forwarded.push({ method, params: check.request.params });
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
              callGasLimit: numberToHex(300_000n),
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

    const hash = await bundler.sendUserOperation({ account, calls: [{ to: PAYMASTER, data: "0x" }] });

    expect(hash).toBe(OP);
    expect(forwarded.map(({ method }) => method)).toContain("pm_getPaymasterData");
    expect(forwarded.at(-1)?.method).toBe("eth_sendUserOperation");
    for (const { method, params } of forwarded.filter(({ method }) => method.startsWith("pm_"))) {
      expect(params[3], method).toEqual({ sponsorshipPolicyId: POLICY });
    }
    // viem tags the callData before it asks for anything, so the estimate and the stub carry the tag too.
    const withOperation = forwarded.filter(({ params }) => typeof params[0] === "object" && params[0] !== null);
    expect(withOperation.map(({ method }) => method)).toEqual([
      "pm_getPaymasterStubData",
      "eth_estimateUserOperationGas",
      "pm_getPaymasterData",
      "eth_sendUserOperation",
    ]);
    for (const { method, params } of withOperation) {
      expect((params[0] as { callData: string }).callData.endsWith(ATTRIBUTION_SUFFIX.slice(2)), method).toBe(true);
    }
  });
});
