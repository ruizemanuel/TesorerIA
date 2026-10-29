/** Past the minute's end, so the retry finds it over even with the time the request takes. */
const MARGIN_MS = 1_000;
/** The route's minute is 60 s: a longer wait isn't one it means, and the heartbeat comes before. */
const LONGEST_WAIT_S = 120;

/** The retry waiting for the minute to end: the page's, so it outlives the panel or the button that asked. */
let retry: ReturnType<typeof setTimeout> | null = null;

/** POSTs to the route, or null when the network failed: either way, the next heartbeat does what this run would. */
async function ask(): Promise<Response | null> {
  try {
    return await fetch("/api/agent/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  } catch {
    return null;
  }
}

/**
 * Asks the agent to run now, after a member's operation (spec, 8.3), and never throws. The route runs at most once a
 * minute for everyone: when another run just took it, it answers 429 with the seconds left in Retry-After, and this
 * asks once more then, so a contribution doesn't wait for the heartbeat (up to 15 minutes). Only once: a second 429
 * means a run started after the operation, and that one covers it. An ask while a retry waits adds no other.
 */
export async function askAgentToRun(): Promise<void> {
  const response = await ask();
  if (response?.status !== 429 || retry !== null) return;
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > LONGEST_WAIT_S) return;
  retry = setTimeout(() => {
    retry = null;
    void ask();
  }, seconds * 1000 + MARGIN_MS);
}
