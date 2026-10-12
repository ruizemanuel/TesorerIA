import { type Hash, pad } from "viem";
import type { BundlerClient, SmartAccount } from "viem/account-abstraction";
import { describe, expect, it } from "vitest";
import { sendTaggedCalls } from "../src/send";

const USER_OP: Hash = pad("0x01", { size: 32 });
const TX: Hash = pad("0x02", { size: 32 });
const BLOCK = 79_925_582n;

/** A bundler that writes down each step; its operations succeed unless `waitFails` says the wait throws. */
function fakeBundler(steps: string[], waitFails?: Error) {
  return {
    sendUserOperation: async () => (steps.push("send"), USER_OP),
    waitForUserOperationReceipt: async () => {
      steps.push("wait");
      if (waitFails) throw waitFails;
      return { success: true, receipt: { transactionHash: TX, blockNumber: BLOCK } };
    },
  } as unknown as BundlerClient;
}

const account = {} as SmartAccount;

describe("sendTaggedCalls", () => {
  it("hands over the UserOperation's hash before waiting for its receipt", async () => {
    const steps: string[] = [];
    const result = await sendTaggedCalls({
      bundlerClient: fakeBundler(steps),
      account,
      calls: [],
      onSent: (hash) => void steps.push(`sent ${hash}`),
    });
    expect(steps).toEqual(["send", `sent ${USER_OP}`, "wait"]);
    expect(result).toEqual({ userOpHash: USER_OP, transactionHash: TX, blockNumber: BLOCK, success: true, reason: undefined });
    expect(result).not.toHaveProperty("unrecorded");
  });

  it("still waits when the hook throws, and says in the result that the hash was not recorded", async () => {
    const steps: string[] = [];
    const result = await sendTaggedCalls({
      bundlerClient: fakeBundler(steps),
      account,
      calls: [],
      onSent: () => {
        throw new Error("offline");
      },
    });
    expect(steps).toEqual(["send", "wait"]);
    expect(result.success).toBe(true);
    expect(result.unrecorded).toBe("offline");
  });

  it("says the same when the hook is async and rejects", async () => {
    const steps: string[] = [];
    const result = await sendTaggedCalls({
      bundlerClient: fakeBundler(steps),
      account,
      calls: [],
      onSent: async () => {
        throw new Error("database is down");
      },
    });
    expect(steps).toEqual(["send", "wait"]);
    expect(result.unrecorded).toBe("database is down");
  });

  it("lets the wait's own error through when the hook worked", async () => {
    const timeout = new Error("timed out");
    await expect(
      sendTaggedCalls({ bundlerClient: fakeBundler([], timeout), account, calls: [], onSent: () => {} }),
    ).rejects.toBe(timeout);
  });

  it("names the hash, the lost record and the wait's error when both the hook and the wait fail", async () => {
    const timeout = new Error("timed out");
    const failure = await sendTaggedCalls({
      bundlerClient: fakeBundler([], timeout),
      account,
      calls: [],
      onSent: async () => {
        throw new Error("database is down");
      },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const { message, cause } = failure as Error;
    expect(message).toContain(USER_OP);
    expect(message).toContain("timed out");
    expect(message).toContain("not recorded: database is down");
    expect(cause).toBe(timeout);
  });

  it("sends with the nonce it's given, and lets the account pick one otherwise", async () => {
    const asked: unknown[] = [];
    const bundlerClient = {
      sendUserOperation: async (parameters: unknown) => (asked.push(parameters), USER_OP),
      waitForUserOperationReceipt: async () => ({ success: true, receipt: { transactionHash: TX, blockNumber: BLOCK } }),
    } as unknown as BundlerClient;
    await sendTaggedCalls({ bundlerClient, account, calls: [], nonce: 0n });
    await sendTaggedCalls({ bundlerClient, account, calls: [] });
    expect(asked[0]).toMatchObject({ nonce: 0n });
    expect(asked[1]).not.toHaveProperty("nonce");
  });
});
