import { RPC_LOG_RANGE } from "@tesoreria/agent";
import { describe, expect, it, vi } from "vitest";
import { RETURN_REFRESH_MS, checkForNews, logRange } from "../src/lib/live";

describe("logRange: the blocks one look reads", () => {
  it("reads from the block after the one the screen was read at, up to the latest", () => {
    expect(logRange(100n, 160n)).toEqual({ fromBlock: 101n, toBlock: 160n });
    expect(logRange(100n, 101n)).toEqual({ fromBlock: 101n, toBlock: 101n });
  });

  it("reads nothing while no block has come after the screen's", () => {
    expect(logRange(160n, 160n)).toBeNull();
    expect(logRange(161n, 160n)).toBeNull();
  });

  it("reads at most what the node answers at once: the latest RPC_LOG_RANGE blocks", () => {
    expect(logRange(0n, RPC_LOG_RANGE)).toEqual({ fromBlock: 1n, toBlock: RPC_LOG_RANGE });
    expect(logRange(0n, 10_000n)).toEqual({ fromBlock: 10_000n - RPC_LOG_RANGE + 1n, toBlock: 10_000n });
  });
});

describe("checkForNews: whether the screen needs the server again", () => {
  /** The chain at block `latest`, with the fund's logs at `blocks`; it answers only for the range it's asked. */
  function chain(latest: bigint, blocks: bigint[]) {
    return {
      latestBlock: vi.fn(async () => latest),
      logsBetween: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
        blocks.filter((b) => b >= fromBlock && b <= toBlock).map((blockNumber) => ({ blockNumber })),
      ),
    };
  }

  it("is false while the fund has no log after the screen's block", async () => {
    const { latestBlock, logsBetween } = chain(160n, [90n, 100n]);
    expect(await checkForNews({ shown: 100n, latestBlock, logsBetween })).toBe(false);
    expect(logsBetween).toHaveBeenCalledWith({ fromBlock: 101n, toBlock: 160n });
  });

  it("is true for a log after the screen's block, and stays true until the screen is read at or after it", async () => {
    const { latestBlock, logsBetween } = chain(160n, [120n]);
    expect(await checkForNews({ shown: 100n, latestBlock, logsBetween })).toBe(true);
    // The server's node was behind: the refreshed screen was read at 110, before the event.
    expect(await checkForNews({ shown: 110n, latestBlock, logsBetween })).toBe(true);
    expect(await checkForNews({ shown: 120n, latestBlock, logsBetween })).toBe(false);
  });

  it("doesn't read logs while no block has come after the screen's", async () => {
    const { latestBlock, logsBetween } = chain(100n, [100n]);
    expect(await checkForNews({ shown: 100n, latestBlock, logsBetween })).toBe(false);
    expect(logsBetween).not.toHaveBeenCalled();
  });

  it("refreshes without asking the chain when the page comes back after RETURN_REFRESH_MS or more", async () => {
    const { latestBlock, logsBetween } = chain(160n, []);
    expect(await checkForNews({ shown: 100n, cameBackAfterMs: RETURN_REFRESH_MS, latestBlock, logsBetween })).toBe(true);
    expect(latestBlock).not.toHaveBeenCalled();
  });

  it("asks the chain as usual when the page was away for less", async () => {
    const { latestBlock, logsBetween } = chain(160n, []);
    expect(await checkForNews({ shown: 100n, cameBackAfterMs: RETURN_REFRESH_MS - 1, latestBlock, logsBetween })).toBe(false);
    expect(logsBetween).toHaveBeenCalledOnce();
  });

  it("lets a failed read throw, so the look can keep what it still has to do", async () => {
    const latestBlock = vi.fn(async () => {
      throw new Error("forno is down");
    });
    await expect(checkForNews({ shown: 100n, latestBlock, logsBetween: vi.fn() })).rejects.toThrow("forno is down");
  });
});
