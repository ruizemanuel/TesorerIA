import { shortMessage } from "@tesoreria/agent";
import { agentContext, agentInFlight, txStatus } from "../../../../lib/agent-context";
import { runAgent } from "../../../../lib/agent-runner";
import { getDb } from "../../../../lib/db/client";
import { env } from "../../../../lib/env";
import { isHeartbeatAuthorized } from "../../../../lib/heartbeat-auth";
import { chainWeekSummaryDeps, writeWeekSummaries } from "../../../../lib/week-summaries";

export const maxDuration = 300;

/**
 * The periodic run (spec, 8.3), called every 15 minutes by a Cloudflare Worker (infra/heartbeat-trigger), with
 * GitHub Actions as a backup. The Action's log is public, so the answer never carries an error's text: the cause goes
 * to our own log.
 */
export async function POST(request: Request) {
  if (!isHeartbeatAuthorized(request.headers.get("authorization"), env().HEARTBEAT_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const db = await getDb();
    const run = await runAgent(db, (onSent) => agentContext(db, onSent), {
      heartbeat: true,
      txStatus,
      inFlight: agentInFlight,
      // After the conversions, under the same lock: each fund's week that just closed (spec, 9.4).
      afterHeartbeat: () => writeWeekSummaries(db, chainWeekSummaryDeps()),
    });
    if (!run.ran) return Response.json({ ran: false }, { status: 202 });
    const counts: Record<string, number> = {};
    for (const d of run.decisions) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
    return Response.json({ ran: true, decisions: counts });
  } catch (error) {
    // Not a 500 for an agent that can't be built (no key, say), but not a 2xx either: the Action must show red.
    console.error(`The heartbeat could not run the agent: ${shortMessage(error)}`);
    return Response.json({ ran: false, reason: "agent unavailable" }, { status: 503 });
  }
}
