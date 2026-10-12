import type { PublicClient } from "viem";

/** How many times a read looks for its block before going ahead without it, BLOCK_LOOK_EVERY_MS apart: about 6 s. */
export const BLOCK_LOOKS = 6;
export const BLOCK_LOOK_EVERY_MS = 1_000;
/**
 * A block this far past the node's isn't waited for: a node that far behind won't catch up in a few seconds, and the
 * block comes from a browser, which could report any.
 */
export const MAX_BLOCKS_AHEAD = 60n;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read-your-writes (spec, 9.2): waits until the node has `block`, the one a member's operation landed in, so a read
 * made right after it shows it. Forno can be a block or two behind the bundler that gave the browser the receipt.
 * It gives up after BLOCK_LOOKS looks, on a block more than MAX_BLOCKS_AHEAD past the node, or when the node can't
 * answer; the read goes ahead either way, and the screen's own looks (LiveFund) or the next heartbeat catch up.
 * Says whether the node reached the block.
 */
export async function waitForBlock(
  client: Pick<PublicClient, "getBlockNumber">,
  block: bigint,
  sleep: (ms: number) => Promise<void> = pause,
): Promise<boolean> {
  for (let look = 1; look <= BLOCK_LOOKS; look++) {
    let head: bigint;
    try {
      head = await client.getBlockNumber({ cacheTime: 0 });
    } catch {
      return false;
    }
    if (head >= block) return true;
    if (block - head > MAX_BLOCKS_AHEAD) return false;
    if (look < BLOCK_LOOKS) await sleep(BLOCK_LOOK_EVERY_MS);
  }
  return false;
}
