import { toDataSuffix, verifyTx } from "@celo/attribution-tags";
import { type Address, type Hash, type Hex, concat, encodeFunctionData, erc20Abi, getAddress } from "viem";
import { type UserOperation, entryPoint07Abi, toPackedUserOperation } from "viem/account-abstraction";
import { describe, expect, it } from "vitest";
import { ATTRIBUTION_CODE, ATTRIBUTION_SUFFIX, isUserOpAttributed } from "../src";

const OURS = getAddress("0x5a6b47f4131bf1feafa56a05573314bcf44c9149");
const OTHER = getAddress("0x2be9a1b6de16bd7dec13d5aa6e3c8a5c8be1f2a7");
const BUNDLER = getAddress("0x4337000c2828f5260d8921fd25829f606b9e8680");
const HASH: Hash = `0x${"ab".repeat(32)}`;
const OTHER_SUFFIX = toDataSuffix("celo_other");

function userOp(sender: Address, suffix: Hex = "0x"): UserOperation<"0.7"> {
  return {
    sender,
    nonce: 0n,
    callData: concat([encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [sender, 1n] }), suffix]),
    callGasLimit: 100_000n,
    verificationGasLimit: 500_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    signature: `0x${"11".repeat(65)}`,
  };
}

/** Stub for the only client method verifyUserOps uses: a handleOps tx carrying `userOps`. */
function bundleClient(...userOps: UserOperation<"0.7">[]) {
  const input = encodeFunctionData({
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [userOps.map((op) => toPackedUserOperation(op)), BUNDLER],
  });
  return { getTransaction: async ({ hash }: { hash: Hash }) => (hash === HASH ? { input } : null) };
}

describe("attribution", () => {
  it("uses TesorerIA's Schema 0 suffix", () => {
    expect(ATTRIBUTION_CODE).toBe("celo_fbe4d00a2cb4");
    expect(ATTRIBUTION_SUFFIX).toBe("0x63656c6f5f666265346430306132636234110080218021802180218021802180218021");
  });

  it("finds our tagged operation, ignoring address case", async () => {
    const client = bundleClient(userOp(OURS, ATTRIBUTION_SUFFIX));
    expect(await isUserOpAttributed({ client, hash: HASH, sender: OURS })).toBe(true);
    expect(await isUserOpAttributed({ client, hash: HASH, sender: OURS.toLowerCase() as Address })).toBe(true);
  });

  it("returns false for our untagged operation", async () => {
    expect(await isUserOpAttributed({ client: bundleClient(userOp(OURS)), hash: HASH, sender: OURS })).toBe(false);
  });

  it("returns null when the transaction is not a bundle or cannot be read", async () => {
    // A plain (non-4337) token transfer, even one carrying our suffix.
    const plainTransfer = { getTransaction: async () => ({ input: userOp(OURS, ATTRIBUTION_SUFFIX).callData }) };
    expect(await isUserOpAttributed({ client: plainTransfer, hash: HASH, sender: OURS })).toBeNull();

    const failingRpc = {
      getTransaction: async (): Promise<{ input: Hex }> => {
        throw new Error("HTTP request failed. Status: 503");
      },
    };
    expect(await isUserOpAttributed({ client: failingRpc, hash: HASH, sender: OURS })).toBeNull();

    const notIndexedYet = { getTransaction: async () => null };
    expect(await isUserOpAttributed({ client: notIndexedYet, hash: HASH, sender: OURS })).toBeNull();
  });

  it("finds our operation in a shared bundle where verifyTx reports another project", async () => {
    const client = bundleClient(userOp(OTHER, OTHER_SUFFIX), userOp(OURS, ATTRIBUTION_SUFFIX));
    expect(await isUserOpAttributed({ client, hash: HASH, sender: OURS })).toBe(true);

    const first = await verifyTx({ client, hash: HASH });
    expect(first?.codes).toEqual(["celo_other"]);
    expect(first?.sender?.toLowerCase()).toBe(OTHER.toLowerCase());
  });

  it("ignores a tag that belongs to another sender", async () => {
    const client = bundleClient(userOp(OTHER, ATTRIBUTION_SUFFIX), userOp(OURS));
    expect(await isUserOpAttributed({ client, hash: HASH, sender: OURS })).toBe(false);
  });
});
