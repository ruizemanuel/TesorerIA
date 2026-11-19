import { type Address, type Hash, getAddress } from "viem";
import { type RpcUserOperation, entryPoint07Address, formatUserOperation, getUserOperationHash } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createForkBundler } from "../src/fork";

const EXECUTOR: Address = getAddress("0x1000000000000000000000000000000000000001");
const TRANSACTION_HASH: Hash = `0x${"cd".repeat(32)}`;
const USER_OPERATION: RpcUserOperation<"0.7"> = {
  sender: getAddress("0x5a6b47f4131bf1feafa56a05573314bcf44c9149"),
  nonce: "0x0",
  callData: "0x",
  callGasLimit: "0x7a1200",
  verificationGasLimit: "0x1e8480",
  preVerificationGas: "0x186a0",
  maxFeePerGas: "0xbf0dcea",
  maxPriorityFeePerGas: "0x3b9aca00",
  signature: "0x",
};

/**
 * A fork that answers eth_sendTransaction after `delayMs`: anvil does, on a fork that hasn't read yet the state the
 * operation touches. It counts the eth_sendTransactions it got. Like fetch, a request whose signal aborts (viem's
 * timeout) fails with an AbortError.
 */
function slowFork(delayMs: number) {
  const fork = { sends: 0 };
  vi.stubGlobal("fetch", async (_url: string, init: { body: string; signal?: AbortSignal | null }) => {
    const { id, method } = JSON.parse(init.body) as { id: number; method: string };
    const answer = (body: object) => new Response(JSON.stringify({ jsonrpc: "2.0", id, ...body }), { headers: { "content-type": "application/json" } });
    switch (method) {
      case "eth_accounts":
        return answer({ result: [EXECUTOR] });
      case "eth_chainId":
        return answer({ result: `0x${celo.id.toString(16)}` });
      case "eth_sendTransaction":
        fork.sends++;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          init.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
        return answer({ result: TRANSACTION_HASH });
      default:
        return answer({ error: { code: -32601, message: `Not expected here: ${method}` } });
    }
  });
  return fork;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the fork bundler", () => {
  it("waits for a fork that takes 11 s to take an operation, as a first createFund on FundFactoryV2 took on a cold fork, and sends it once", async () => {
    vi.useFakeTimers();
    const fork = slowFork(11_000);
    let settled: { hash: unknown } | { error: string } | undefined;
    createForkBundler({ rpcUrl: "http://fork.test" })
      .request({ method: "eth_sendUserOperation", params: [USER_OPERATION, entryPoint07Address] })
      .then(
        (hash) => (settled = { hash }),
        (error: Error) => (settled = { error: error.message }),
      );
    await vi.advanceTimersByTimeAsync(12_000);
    const userOperation = formatUserOperation(USER_OPERATION);
    const hash = getUserOperationHash({ chainId: celo.id, entryPointAddress: entryPoint07Address, entryPointVersion: "0.7", userOperation });
    expect(settled).toEqual({ hash });
    expect(fork.sends).toBe(1);
  });
});
