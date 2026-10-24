import { type Hash, createPublicClient, http, pad } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogReader, RawLog } from "@tesoreria/agent";
import { BLOCK_OUT_OF_RANGE, NODE_FALLBACK_BLOCKS, quickCeloClient, retryingBlockOutOfRange, userOperationFinder, withNodeFallback } from "../src/lib/chain";

const OP: Hash = pad("0x0b", { size: 32 });
const RESEND: Hash = pad("0x0c", { size: 32 });
const TX: Hash = pad("0x7a", { size: 32 });
const LATEST = 100_000n;
const NOW = 1_800_000_000n; // the latest block's time, in seconds

type Query = { address: string; args: { userOpHash: Hash[] }; fromBlock: bigint; toBlock: bigint };

/** A node whose latest block is LATEST at NOW, with this operation's UserOperationEvent in block `at`, if any. */
function node(landed?: { at: bigint; userOpHash: Hash; success: boolean }) {
  const getLogs = vi.fn(async ({ fromBlock, toBlock }: Query) =>
    landed !== undefined && landed.at >= fromBlock && landed.at <= toBlock
      ? [{ args: { userOpHash: landed.userOpHash, success: landed.success }, transactionHash: TX, blockNumber: landed.at }]
      : [],
  );
  const getBlock = vi.fn(async () => ({ number: LATEST, timestamp: NOW }));
  return { getLogs, getBlock };
}
const secondsAgo = (seconds: bigint) => new Date(Number(NOW - seconds) * 1000);

describe("userOperationFinder", () => {
  it("looks for the operations' UserOperationEvent, by their hash, from about the block they were sent in", async () => {
    const chain = node({ at: LATEST - 3_000n, userOpHash: OP, success: true });
    const find = userOperationFinder(chain as never);
    expect(await find({ userOpHashes: [OP, RESEND], since: secondsAgo(3_600n) })).toEqual({ userOpHash: OP, transactionHash: TX, success: true });
    // About one block a second, and ten minutes before that for the clocks: one request covers it.
    expect(chain.getLogs).toHaveBeenCalledTimes(1);
    const [query] = chain.getLogs.mock.calls[0]!;
    expect(query).toMatchObject({ address: entryPoint07Address, args: { userOpHash: [OP, RESEND] }, fromBlock: LATEST - 3_600n - 600n, toBlock: LATEST });
  });

  it("reads 5,000 blocks at a time, oldest first, and stops at the first one that has it", async () => {
    const chain = node({ at: LATEST - 14_000n, userOpHash: RESEND, success: false });
    const find = userOperationFinder(chain as never);
    expect(await find({ userOpHashes: [OP, RESEND], since: secondsAgo(20_000n) })).toEqual({ userOpHash: RESEND, transactionHash: TX, success: false });
    const ranges = chain.getLogs.mock.calls.map(([query]) => [query.fromBlock, query.toBlock]);
    expect(ranges).toEqual([
      [79_400n, 84_399n],
      [84_400n, 89_399n],
    ]);
  });

  it("answers null when it isn't there up to the latest block", async () => {
    const chain = node();
    const find = userOperationFinder(chain as never);
    expect(await find({ userOpHashes: [OP], since: secondsAgo(12_000n) })).toBeNull();
    const ranges = chain.getLogs.mock.calls.map(([query]) => [query.fromBlock, query.toBlock]);
    expect(ranges.at(0)?.[0]).toBe(LATEST - 12_600n);
    expect(ranges.at(-1)?.[1]).toBe(LATEST);
    expect(ranges).toHaveLength(3);
  });
});

describe("withNodeFallback", () => {
  const FUND = "0x00000000000000000000000000000000000F00D5" as const;
  const LOG: RawLog = { address: FUND, topics: [], data: "0x", blockNumber: 5n, transactionHash: TX, logIndex: 0 };
  const failing: LogReader = async () => {
    throw new Error("Blockscout answered HTTP 429 for its indexed block");
  };

  it("reads a short history from the node when Blockscout fails", async () => {
    const node = vi.fn<LogReader>(async () => [LOG]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = withNodeFallback(failing, node);
    expect(await read({ address: FUND, fromBlock: 1n, toBlock: NODE_FALLBACK_BLOCKS })).toEqual([LOG]);
    expect(node).toHaveBeenCalledWith({ address: FUND, fromBlock: 1n, toBlock: NODE_FALLBACK_BLOCKS });
  });

  it("still throws for a history longer than the node should read alone", async () => {
    const node = vi.fn<LogReader>(async () => [LOG]);
    const read = withNodeFallback(failing, node);
    await expect(read({ address: FUND, fromBlock: 0n, toBlock: NODE_FALLBACK_BLOCKS })).rejects.toThrow("HTTP 429");
    expect(node).not.toHaveBeenCalled();
  });

  it("asks the node nothing while Blockscout answers", async () => {
    const node = vi.fn<LogReader>(async () => []);
    const read = withNodeFallback(async () => [LOG], node);
    expect(await read({ address: FUND, fromBlock: 1n, toBlock: 10n })).toEqual([LOG]);
    expect(node).not.toHaveBeenCalled();
  });
});

describe("quickCeloClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("gives up on a read that doesn't answer within its time, after one try", async () => {
    vi.stubEnv("RP_ID", "localhost");
    vi.stubEnv("ORIGIN", "http://localhost:3000");
    vi.stubEnv("SESSION_SECRET", "a-session-secret-for-tests-only-0123456789");
    vi.stubEnv("DATABASE_URL", "memory");
    vi.stubEnv("CELO_RPC_URL", "http://celo.test");
    // A node that never answers: only the request's own signal ends it.
    const node = vi.fn(
      (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    vi.stubGlobal("fetch", node);
    const started = Date.now();
    await expect(quickCeloClient(100).getChainId()).rejects.toThrow(/took too long/);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(node).toHaveBeenCalledTimes(1);
    expect(new URL(String(node.mock.calls[0]?.[0])).host).toBe("celo.test"); // CELO_RPC_URL's node
  });
});

describe("retryingBlockOutOfRange (21/10: forno's -32019)", () => {
  const ACCOUNT = "0x00000000000000000000000000000000000A11CE" as const;
  const outOfRange = { error: { code: BLOCK_OUT_OF_RANGE, message: "block is out of range" } };
  const balance = { result: "0x1" };

  /** A Celo client on viem's own http transport, whose node answers `answers` in turn, the way forno does. */
  function clientAnswering(answers: object[], retries?: number) {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { id } = JSON.parse(String(init?.body)) as { id: number };
      return Response.json({ jsonrpc: "2.0", id, ...answers.shift() });
    });
    const transport = retryingBlockOutOfRange(http("https://node.test", { fetchFn, retryCount: 0 }), { retries, delayMs: 0 });
    return { client: createPublicClient({ chain: celo, transport }), fetchFn };
  }

  it("asks again a read at a block the node it reached doesn't have yet, and answers once one does", async () => {
    const { client, fetchFn } = clientAnswering([outOfRange, outOfRange, balance]);
    expect(await client.getBalance({ address: ACCOUNT, blockNumber: 80_687_423n })).toBe(1n);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("gives up after its retries, with the node's error", async () => {
    const { client, fetchFn } = clientAnswering([outOfRange, outOfRange, outOfRange, balance], 2);
    await expect(client.getBalance({ address: ACCOUNT, blockNumber: 80_687_423n })).rejects.toThrow(/block is out of range/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("never asks again on any other error", async () => {
    const { client, fetchFn } = clientAnswering([{ error: { code: -32602, message: "invalid params" } }, balance]);
    await expect(client.getBalance({ address: ACCOUNT, blockNumber: 80_687_423n })).rejects.toThrow(/invalid params/i);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
