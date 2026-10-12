import { RPC_LOG_RANGE } from "@tesoreria/agent";

/** How often an open fund screen asks the chain whether something happened (spec, 9.2). */
export const LOOK_EVERY_MS = 15_000;
/** Back on the page after this long, the screen is refreshed anyway: expenses others enter aren't on the chain. */
export const RETURN_REFRESH_MS = 60_000;

/**
 * The blocks one look reads: every one after the block the screen was read at (`shown`), up to `latest`, or the last
 * RPC_LOG_RANGE of them, all a public node answers at once. Older ones were read by earlier looks, or the page was
 * away and comes back with a refresh. Null while no block has come after the screen's.
 */
export function logRange(shown: bigint, latest: bigint): { fromBlock: bigint; toBlock: bigint } | null {
  if (latest <= shown) return null;
  const oldest = latest - RPC_LOG_RANGE + 1n;
  return { fromBlock: shown + 1n > oldest ? shown + 1n : oldest, toBlock: latest };
}

/**
 * Whether the screen, read at block `shown`, needs the server again: when the page comes back after
 * RETURN_REFRESH_MS or more, or when the fund has a log after `shown`. Each look reads from `shown` again, so a
 * refresh whose server read the chain before the event (its node can be a few seconds behind) is followed by another.
 * A failed read throws.
 */
export async function checkForNews({
  shown,
  cameBackAfterMs,
  latestBlock,
  logsBetween,
}: {
  shown: bigint;
  cameBackAfterMs?: number;
  latestBlock: () => Promise<bigint>;
  logsBetween: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<readonly { blockNumber: bigint | null }[]>;
}): Promise<boolean> {
  if (cameBackAfterMs !== undefined && cameBackAfterMs >= RETURN_REFRESH_MS) return true;
  const range = logRange(shown, await latestBlock());
  if (range === null) return false;
  const logs = await logsBetween(range);
  return logs.some((log) => log.blockNumber !== null && log.blockNumber > shown);
}
