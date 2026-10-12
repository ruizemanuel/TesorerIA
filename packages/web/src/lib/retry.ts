/** How long the error page waits before each try of its own: a few seconds first, then longer (spec, 9.2). */
export const RETRY_DELAYS_MS = [2_000, 8_000, 30_000] as const;
/** Tries older than this don't count: a page that fails again a while later starts over. */
export const RETRY_WINDOW_MS = 120_000;

/**
 * When the error page asks the server for the page again by itself, given when it last did (`tries`, epoch ms):
 * the wait before the next try, or null once the recent ones are used up and it's the person's turn.
 */
export function nextRetryDelay(tries: readonly number[], now: number): number | null {
  const recent = tries.filter((at) => now - at < RETRY_WINDOW_MS).length;
  return RETRY_DELAYS_MS[recent] ?? null;
}
