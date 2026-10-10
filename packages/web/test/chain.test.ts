import { type Hash, pad } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { describe, expect, it, vi } from "vitest";
import { userOperationFinder } from "../src/lib/chain";

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
