/** The Worker's settings (see wrangler.toml). */
interface Env {
  HEARTBEAT_URL: string;
  HEARTBEAT_SECRET?: string;
}

/** What we use of a Cron Trigger's event. */
interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

/** Just above the heartbeat route's limit (maxDuration, 300 s): the route always answers first. */
const TIMEOUT_MS = 310_000;

/**
 * One heartbeat, and its answer: the decisions it made (200), or that a run was already going (202). The answer
 * never carries an error's text, so it can go to the log. Anything else throws, so the run shows as failed.
 */
async function beat(env: Env): Promise<string> {
  if (!env.HEARTBEAT_SECRET) throw new Error("HEARTBEAT_SECRET is not set"); // never send "Bearer undefined"
  const response = await fetch(env.HEARTBEAT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${env.HEARTBEAT_SECRET}`, "user-agent": "tesoreria-heartbeat" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const answer = await response.text();
  if (!response.ok) throw new Error(`The heartbeat answered ${response.status}: ${answer.slice(0, 200)}`);
  return answer;
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const answer = await beat(env);
    console.log(`heartbeat for ${new Date(controller.scheduledTime).toISOString()} (${controller.cron}): ${answer}`);
  },
};
