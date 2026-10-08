import { inspect } from "node:util";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  type Address,
  type Hash,
  type Hex,
  concat,
  createPublicClient,
  custom,
  encodeErrorResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
} from "viem";
import {
  type SmartAccount,
  createBundlerClient,
  entryPoint07Abi,
  entryPoint07Address,
  toSmartAccount,
} from "viem/account-abstraction";
import { celo } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_SUFFIX, type Call, createPimlicoBundlerClient, pimlicoTransport, sendTaggedCalls } from "../src";

const SENDER = getAddress("0x5a6b47f4131bf1feafa56a05573314bcf44c9149");
const USDT: Address = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const PAYMASTER: Address = "0x777777777777AeC03fd955926DbF81597e66834C";
const SPONSORSHIP_POLICY_ID = "sp_tesoreria_test";
const STUB_PAYMASTER_DATA: Hex = `0x01${"00".repeat(52)}`;
const PAYMASTER_DATA: Hex = `0x01${"5c".repeat(52)}`;
const USER_OP_HASH: Hash = `0x${"ab".repeat(32)}`;
const TRANSACTION_HASH: Hash = `0x${"cd".repeat(32)}`;
const GAS_PRICE = {
  slow: { maxFeePerGas: "0x5d21dba00", maxPriorityFeePerGas: "0x3b9aca00" },
  standard: { maxFeePerGas: "0x6fc23ac00", maxPriorityFeePerGas: "0x3b9aca00" },
  fast: { maxFeePerGas: "0x826299e00", maxPriorityFeePerGas: "0x77359400" },
};
const USER_OPERATION_RECEIPT = {
  userOpHash: USER_OP_HASH,
  entryPoint: entryPoint07Address,
  sender: SENDER,
  nonce: "0x7",
  paymaster: PAYMASTER,
  actualGasCost: "0x2a9ae5c4f3a0",
  actualGasUsed: "0x2c5e1",
  success: true,
  reason: "0x",
  logs: [],
  receipt: {
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x0",
    blockHash: `0x${"ef".repeat(32)}`,
    blockNumber: "0x4be61b6",
    from: "0x4337000c2828f5260d8921fd25829f606b9e8680",
    to: entryPoint07Address,
    cumulativeGasUsed: "0x5c8d0",
    gasUsed: "0x5c8d0",
    contractAddress: null,
    logs: [],
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    effectiveGasPrice: "0x6fc23ac00",
    type: "0x2",
  },
};

// Error(string) revert data, as a bundler reports it for a UserOperation whose call reverted.
const REVERT_REASON = encodeErrorResult({
  abi: [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }],
  errorName: "Error",
  args: ["transfer amount exceeds balance"],
});

type RpcCall = { method: string; params: any };

/** Mock of Pimlico's bundler + ERC-7677 paymaster endpoint that records every request. */
function mockPimlico(userOperationReceipt: object = USER_OPERATION_RECEIPT) {
  const requests: RpcCall[] = [];
  const transport = custom({
    async request({ method, params }) {
      requests.push({ method, params });
      switch (method) {
        case "pimlico_getUserOperationGasPrice":
          return GAS_PRICE;
        case "pm_getPaymasterStubData":
          return {
            paymaster: PAYMASTER,
            paymasterData: STUB_PAYMASTER_DATA,
            paymasterVerificationGasLimit: "0x8a8e",
            paymasterPostOpGasLimit: "0x1",
            sponsor: { name: "Pimlico" },
            isFinal: false,
          };
        case "eth_estimateUserOperationGas":
          return {
            preVerificationGas: "0xd3e3",
            verificationGasLimit: "0x60b01",
            callGasLimit: "0x13880",
            paymasterVerificationGasLimit: "0x8a8e",
            paymasterPostOpGasLimit: "0x1",
          };
        case "pm_getPaymasterData":
          return { paymaster: PAYMASTER, paymasterData: PAYMASTER_DATA };
        case "eth_sendUserOperation":
          return USER_OP_HASH;
        case "eth_getUserOperationReceipt":
          return userOperationReceipt;
        default:
          throw new Error(`unexpected Pimlico RPC: ${method}`);
      }
    },
  });
  const find = (method: string) => {
    const request = requests.find((r) => r.method === method);
    if (!request) throw new Error(`${method} was not called`);
    return request.params;
  };
  return { transport, requests, find };
}

/** Public client of a deployed account (the only call the flow makes to it is eth_getCode). */
function mockPublicClient() {
  return createPublicClient({
    chain: celo,
    transport: custom({
      async request({ method }) {
        if (method === "eth_getCode") return "0x6001";
        throw new Error(`unexpected public RPC: ${method}`);
      },
    }),
  });
}

/** Stub smart account that records the callData it signs. */
async function stubAccount(client: ReturnType<typeof mockPublicClient>) {
  const batchAbi = parseAbi(["function executeBatch((address to, uint256 value, bytes data)[] calls)"]);
  const signed: Hex[] = [];
  const account: SmartAccount = await toSmartAccount({
    client,
    entryPoint: { abi: entryPoint07Abi, address: entryPoint07Address, version: "0.7" },
    async decodeCalls() {
      return [];
    },
    async encodeCalls(calls) {
      const args = calls.map((c) => ({ to: c.to, value: c.value ?? 0n, data: c.data ?? "0x" }));
      return encodeFunctionData({ abi: batchAbi, functionName: "executeBatch", args: [args] });
    },
    async getAddress() {
      return SENDER;
    },
    async getFactoryArgs() {
      return { factory: undefined, factoryData: undefined };
    },
    async getNonce() {
      return 7n;
    },
    async getStubSignature() {
      return `0x${"ff".repeat(65)}`;
    },
    async signMessage() {
      return "0x";
    },
    async signTypedData() {
      return "0x";
    },
    async signUserOperation(userOperation) {
      signed.push(userOperation.callData);
      return `0x${"22".repeat(65)}`;
    },
  });
  return { account, signed };
}

describe("Pimlico bundler client", () => {
  it("builds Pimlico's RPC URL from the chain id", () => {
    const transport = pimlicoTransport("pim_test")({ chain: celo });
    expect(transport.value?.url).toBe("https://api.pimlico.io/v2/42220/rpc?apikey=pim_test");
  });

  it("sends a sponsored, tagged UserOperation and returns its transaction hash", async () => {
    const pimlico = mockPimlico();
    const client = mockPublicClient();
    const { account, signed } = await stubAccount(client);
    const bundlerClient = createPimlicoBundlerClient({
      client,
      transport: pimlico.transport,
      sponsorshipPolicyId: SPONSORSHIP_POLICY_ID,
    });
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [SENDER, 1n] });
    const calls: Call[] = [
      { to: USDT, data: transfer },
      { to: USDT, data: transfer },
    ];

    const result = await sendTaggedCalls({ bundlerClient, account, calls });

    const callData = concat([await account.encodeCalls(calls), ATTRIBUTION_SUFFIX]); // suffix exactly once, at the end
    for (const method of [
      "pm_getPaymasterStubData",
      "eth_estimateUserOperationGas",
      "pm_getPaymasterData",
      "eth_sendUserOperation",
    ]) {
      expect(pimlico.find(method)[0].callData, method).toBe(callData);
    }
    expect(signed).toEqual([callData]);

    for (const method of ["pm_getPaymasterStubData", "pm_getPaymasterData"]) {
      const [, entryPoint, chainId, context] = pimlico.find(method);
      expect([entryPoint, chainId, context]).toEqual([
        entryPoint07Address,
        "0xa4ec",
        { sponsorshipPolicyId: SPONSORSHIP_POLICY_ID },
      ]);
    }

    const [sent, entryPoint] = pimlico.find("eth_sendUserOperation");
    expect(entryPoint).toBe(entryPoint07Address);
    expect(sent.maxFeePerGas).toBe(GAS_PRICE.fast.maxFeePerGas);
    expect(sent.maxPriorityFeePerGas).toBe(GAS_PRICE.fast.maxPriorityFeePerGas);
    expect(sent.paymaster).toBe(PAYMASTER);
    expect(sent.paymasterData).toBe(PAYMASTER_DATA);
    expect(sent.signature).toBe(`0x${"22".repeat(65)}`);

    expect(result).toStrictEqual({
      userOpHash: USER_OP_HASH,
      transactionHash: TRANSACTION_HASH,
      success: true,
      reason: undefined,
    });
  });

  it("tags the operation even when the bundler client was created without the suffix", async () => {
    const pimlico = mockPimlico();
    const client = mockPublicClient();
    const { account, signed } = await stubAccount(client);
    // The wiring of createPimlicoBundlerClient on a plain viem client: no dataSuffix.
    const pimlicoClient = createPimlicoClient({
      transport: pimlico.transport,
      entryPoint: { address: entryPoint07Address, version: "0.7" },
    });
    const bundlerClient = createBundlerClient({
      client,
      transport: pimlico.transport,
      paymaster: pimlicoClient,
      paymasterContext: { sponsorshipPolicyId: SPONSORSHIP_POLICY_ID },
      userOperation: { estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast },
    });
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [SENDER, 1n] });
    const calls: Call[] = [{ to: USDT, data: transfer }];

    await sendTaggedCalls({ bundlerClient, account, calls });

    const callData = concat([await account.encodeCalls(calls), ATTRIBUTION_SUFFIX]); // suffix exactly once, at the end
    for (const method of [
      "pm_getPaymasterStubData",
      "eth_estimateUserOperationGas",
      "pm_getPaymasterData",
      "eth_sendUserOperation",
    ]) {
      expect(pimlico.find(method)[0].callData, method).toBe(callData);
    }
    expect(signed).toEqual([callData]);
  });

  it("reports a failed operation with the bundler's revert reason", async () => {
    // The bundle transaction itself succeeds (status 0x1); only the UserOperation reverted.
    const pimlico = mockPimlico({ ...USER_OPERATION_RECEIPT, success: false, reason: REVERT_REASON });
    const client = mockPublicClient();
    const { account } = await stubAccount(client);
    const bundlerClient = createPimlicoBundlerClient({
      client,
      transport: pimlico.transport,
      sponsorshipPolicyId: SPONSORSHIP_POLICY_ID,
    });
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [SENDER, 10n ** 12n] });

    const result = await sendTaggedCalls({ bundlerClient, account, calls: [{ to: USDT, data: transfer }], timeout: 5_000 });

    expect(result).toStrictEqual({
      userOpHash: USER_OP_HASH,
      transactionHash: TRANSACTION_HASH,
      success: false,
      reason: REVERT_REASON,
    });
  });
});

describe("Pimlico API key redaction", () => {
  // Fake key with characters that encodeURIComponent changes, so both forms are checked.
  const API_KEY = "pim_fake key/Zz+9";
  const ENCODED_API_KEY = encodeURIComponent(API_KEY);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Runs a request through the real http transport against a stubbed `fetch` and returns what it throws. */
  async function failedRequest(respond: () => Response) {
    const fetchMock = vi.fn(async () => respond());
    vi.stubGlobal("fetch", fetchMock);
    const bundlerClient = createPimlicoBundlerClient({
      client: mockPublicClient(),
      transport: pimlicoTransport(API_KEY),
      sponsorshipPolicyId: SPONSORSHIP_POLICY_ID,
    });
    const error = await bundlerClient.request({ method: "eth_supportedEntryPoints" }).then(
      () => {
        throw new Error("expected the request to fail");
      },
      (error: unknown) => error as Error,
    );
    return { error, fetchMock, printed: inspect(error, { depth: null }) };
  }

  function expectRedacted(printed: string) {
    expect(printed).not.toContain(API_KEY);
    expect(printed).not.toContain(ENCODED_API_KEY);
    expect(printed).toContain("api.pimlico.io");
  }

  it("keeps the key out of a JSON-RPC error", async () => {
    const { error, fetchMock, printed } = await failedRequest(
      () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid sponsorship policy" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    expectRedacted(printed);
    expect(error.name).toBe("InvalidParamsRpcError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the key out of an HTTP 401", async () => {
    const { error, fetchMock, printed } = await failedRequest(
      () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    );

    expectRedacted(printed);
    expect(error.name).toBe("HttpRequestError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
