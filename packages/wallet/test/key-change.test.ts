import { type Address, type Hex, type Transport, custom, decodeFunctionData, pad, parseAbi, size, slice } from "viem";
import { type SmartAccount, createBundlerClient, entryPoint07Address } from "viem/account-abstraction";
import { describe, expect, it } from "vitest";
import { ATTRIBUTION_SUFFIX, SAFE_P256_VERIFIERS, createTaggedBundlerClient } from "../src";
import {
  SAFE_WEBAUTHN_SHARED_SIGNER,
  isSafeKey,
  keyChangeCallData,
  safeKeyOf,
  sendKeyChange,
} from "../src/key-change";

// A made-up P-256 point (x ‖ y, 32 + 32 bytes): nothing here is verified on-curve.
const X: Hex = `0x${"11".repeat(32)}`;
const Y: Hex = `0x${"22".repeat(31)}33`;
const PUBLIC_KEY: Hex = `${X}${Y.slice(2)}`;

const safe4337Abi = parseAbi([
  "function executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)",
]);
const signerAbi = parseAbi(["function configure((uint256 x, uint256 y, uint176 verifiers) signer)"]);

/** The call data without the attribution suffix that closes it. */
function withoutSuffix(callData: Hex): Hex {
  return slice(callData, 0, size(callData) - size(ATTRIBUTION_SUFFIX));
}

describe("safeKeyOf", () => {
  it("splits x ‖ y and pairs it with the verifiers every member's Safe is set up with", () => {
    expect(safeKeyOf(PUBLIC_KEY)).toEqual({ x: BigInt(X), y: BigInt(Y), verifiers: BigInt(SAFE_P256_VERIFIERS) });
  });

  it("rejects a key with the 04 prefix (65 bytes) and one that is a byte short (63)", () => {
    expect(() => safeKeyOf(`0x04${PUBLIC_KEY.slice(2)}`)).toThrow(/64 bytes/);
    expect(() => safeKeyOf(PUBLIC_KEY.slice(0, -2) as Hex)).toThrow(/64 bytes/);
  });

  it("rejects an odd number of hex digits, which viem would still count as 64 bytes", () => {
    const unpadded = PUBLIC_KEY.slice(0, -1) as Hex; // 127 digits: ceil(127 / 2) = 64 "bytes", but y would shift by a nibble
    expect(() => safeKeyOf(unpadded)).toThrow(/64 bytes/);
    expect(() => keyChangeCallData(unpadded)).toThrow(/64 bytes/);
    expect(() => safeKeyOf(`${PUBLIC_KEY}0` as Hex)).toThrow(/64 bytes/); // 129 digits
  });

  it("rejects something that is not hex", () => {
    expect(() => safeKeyOf("not a key" as Hex)).toThrow(/64 bytes/);
  });
});

describe("isSafeKey", () => {
  it("is true for the key's own x, y and verifiers", () => {
    expect(isSafeKey(safeKeyOf(PUBLIC_KEY), PUBLIC_KEY)).toBe(true);
  });

  it("is false when any one of x, y and verifiers differs", () => {
    const key = safeKeyOf(PUBLIC_KEY);
    expect(isSafeKey({ ...key, x: key.x + 1n }, PUBLIC_KEY)).toBe(false);
    expect(isSafeKey({ ...key, y: key.y + 1n }, PUBLIC_KEY)).toBe(false);
    expect(isSafeKey({ ...key, verifiers: key.verifiers + 1n }, PUBLIC_KEY)).toBe(false);
  });

  it("is false for a Safe whose signer was never configured", () => {
    expect(isSafeKey({ x: 0n, y: 0n, verifiers: 0n }, PUBLIC_KEY)).toBe(false);
  });
});

describe("keyChangeCallData", () => {
  it("ends with the attribution suffix, once", () => {
    const callData = keyChangeCallData(PUBLIC_KEY);
    expect(callData.endsWith(ATTRIBUTION_SUFFIX.slice(2))).toBe(true);
    const body = withoutSuffix(callData);
    expect(body.endsWith(ATTRIBUTION_SUFFIX.slice(2))).toBe(false);
  });

  it("delegatecalls the shared signer's configure with the key and the Safe's verifiers", () => {
    const callData = keyChangeCallData(PUBLIC_KEY);
    const body = withoutSuffix(callData);

    const executed = decodeFunctionData({ abi: safe4337Abi, data: body });
    const [to, value, data, operation] = executed.args;
    expect(to).toBe(SAFE_WEBAUTHN_SHARED_SIGNER);
    expect(value).toBe(0n);
    expect(operation).toBe(1); // delegatecall: configure writes to the Safe's own storage

    const configured = decodeFunctionData({ abi: signerAbi, data });
    expect(configured.functionName).toBe("configure");
    expect(configured.args[0]).toEqual({ x: BigInt(X), y: BigInt(Y), verifiers: BigInt(SAFE_P256_VERIFIERS) });
  });

  it("refuses a malformed key instead of building a call that would lock the Safe", () => {
    expect(() => keyChangeCallData(`0x04${PUBLIC_KEY.slice(2)}`)).toThrow(/64 bytes/);
  });
});

describe("sendKeyChange", () => {
  const sender: Address = "0x000000000000000000000000000000000000dEaD";

  /** The smallest account viem's bundler actions will send for: nothing is signed or deployed. */
  const account = {
    address: sender,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    getFactoryArgs: async () => ({ factory: undefined, factoryData: undefined }),
    getNonce: async () => 0n,
    getStubSignature: async () => "0x",
    signUserOperation: async () => "0x",
  } as unknown as SmartAccount;

  /** A transport that answers the bundler methods and keeps the UserOperation `eth_sendUserOperation` was given. */
  function recordingTransport() {
    const sent: { callData: Hex }[] = [];
    const transport = custom({
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        switch (method) {
          case "eth_estimateUserOperationGas":
            return { callGasLimit: "0x1", verificationGasLimit: "0x1", preVerificationGas: "0x1" };
          case "eth_getBlockByNumber": // what viem asks for fees when the client has no fee hook
            return { baseFeePerGas: "0x1", number: "0x1", transactions: [] };
          case "eth_maxPriorityFeePerGas":
            return "0x1";
          case "eth_sendUserOperation":
            sent.push((params as [{ callData: Hex }])[0]);
            return pad("0x01", { size: 32 });
          case "eth_getUserOperationReceipt":
            return { success: true, receipt: { transactionHash: pad("0x02", { size: 32 }), blockNumber: "0x10" } };
          default:
            throw new Error(`unexpected ${method}`);
        }
      },
    });
    return { sent, transport };
  }

  // viem handles the suffix differently depending on how the client gets its fees. With `userOperation.estimateFeesPerGas`
  // (as `createPimlicoBundlerClient` has) it hands the callData back as it was given, dropping any suffix it added; without
  // it, the suffix is added on top. A tagged client has a suffix of its own either way.
  const feeHook = { estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }) };
  const clients = [
    ["a plain client with a fee hook", (transport: Transport) => createBundlerClient({ transport, userOperation: feeHook })],
    ["a plain client without one", (transport: Transport) => createBundlerClient({ transport })],
    ["a tagged client with a fee hook", (transport: Transport) => createTaggedBundlerClient({ transport, userOperation: feeHook })],
    ["a tagged client without one", (transport: Transport) => createTaggedBundlerClient({ transport })],
  ] as const;

  function suffixCount(callData: Hex) {
    return callData.split(ATTRIBUTION_SUFFIX.slice(2)).length - 1;
  }

  it.each(clients)("sends exactly the callData keyChangeCallData builds, suffix once, with %s", async (_, createClient) => {
    const { sent, transport } = recordingTransport();
    const result = await sendKeyChange({
      bundlerClient: createClient(transport),
      account,
      publicKey: PUBLIC_KEY,
      timeout: 1_000,
    });

    expect(result.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.callData).toBe(keyChangeCallData(PUBLIC_KEY));
    expect(suffixCount(sent[0]!.callData)).toBe(1);
  });

  it("hands over the hash before waiting, as sendTaggedCalls does", async () => {
    const { transport } = recordingTransport();
    const hashes: Hex[] = [];
    await sendKeyChange({
      bundlerClient: createTaggedBundlerClient({ transport, userOperation: feeHook }),
      account,
      publicKey: PUBLIC_KEY,
      onSent: (hash) => void hashes.push(hash),
    });
    expect(hashes).toEqual([pad("0x01", { size: 32 })]);
  });
});
