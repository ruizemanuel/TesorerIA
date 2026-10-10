import { type Hash, pad } from "viem";
import type { BundlerClient, SmartAccount } from "viem/account-abstraction";
import { describe, expect, it } from "vitest";
import { sendTaggedCalls } from "../src/send";

const USER_OP: Hash = pad("0x01", { size: 32 });
const TX: Hash = pad("0x02", { size: 32 });

/** A bundler that writes down each step, and whose operations always succeed. */
function fakeBundler(steps: string[]) {
  return {
    sendUserOperation: async () => (steps.push("send"), USER_OP),
    waitForUserOperationReceipt: async () => (steps.push("wait"), { success: true, receipt: { transactionHash: TX } }),
  } as unknown as BundlerClient;
}

describe("sendTaggedCalls", () => {
  it("hands over the UserOperation's hash before waiting for its receipt", async () => {
    const steps: string[] = [];
    const result = await sendTaggedCalls({
      bundlerClient: fakeBundler(steps),
      account: {} as SmartAccount,
      calls: [],
      onSent: (hash) => void steps.push(`sent ${hash}`),
    });
    expect(steps).toEqual(["send", `sent ${USER_OP}`, "wait"]);
    expect(result).toEqual({ userOpHash: USER_OP, transactionHash: TX, success: true, reason: undefined });
  });

  it("still waits when the hook throws: the operation is already out", async () => {
    const steps: string[] = [];
    const result = await sendTaggedCalls({
      bundlerClient: fakeBundler(steps),
      account: {} as SmartAccount,
      calls: [],
      onSent: () => {
        throw new Error("offline");
      },
    });
    expect(steps).toEqual(["send", "wait"]);
    expect(result.success).toBe(true);
  });
});
