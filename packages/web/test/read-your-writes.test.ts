import { describe, expect, it } from "vitest";
import { BLOCK_LOOKS, BLOCK_LOOK_EVERY_MS, MAX_BLOCKS_AHEAD, waitForBlock } from "../src/lib/read-your-writes";

/** A node whose head is each of `heads` in turn, and the last one from then on; `null` fails. */
function node(...heads: (bigint | null)[]) {
  let looks = 0;
  return {
    get looks() {
      return looks;
    },
    getBlockNumber: async () => {
      const head = heads[Math.min(looks++, heads.length - 1)];
      if (head === null || head === undefined) throw new Error("forno is down");
      return head;
    },
  };
}
const noPause = async () => {};

describe("waitForBlock: read-your-writes (spec, 9.2)", () => {
  it("goes ahead at once when the node already has the block", async () => {
    const forno = node(101n);
    expect(await waitForBlock(forno, 100n, noPause)).toBe(true);
    expect(forno.looks).toBe(1);
  });

  it("waits, a second at a time, for a node a block or two behind", async () => {
    const forno = node(98n, 99n, 100n);
    const pauses: number[] = [];
    expect(await waitForBlock(forno, 100n, async (ms) => void pauses.push(ms))).toBe(true);
    expect(pauses).toEqual([BLOCK_LOOK_EVERY_MS, BLOCK_LOOK_EVERY_MS]);
  });

  it("gives up after BLOCK_LOOKS looks, without a pause after the last one", async () => {
    const forno = node(98n);
    const pauses: number[] = [];
    expect(await waitForBlock(forno, 100n, async (ms) => void pauses.push(ms))).toBe(false);
    expect(forno.looks).toBe(BLOCK_LOOKS);
    expect(pauses).toHaveLength(BLOCK_LOOKS - 1);
  });

  it("doesn't wait for a block far past the node, nor while the node fails", async () => {
    const behind = node(100n);
    expect(await waitForBlock(behind, 100n + MAX_BLOCKS_AHEAD + 1n, noPause)).toBe(false);
    expect(behind.looks).toBe(1);
    const down = node(null);
    expect(await waitForBlock(down, 100n, noPause)).toBe(false);
    expect(down.looks).toBe(1);
  });
});
