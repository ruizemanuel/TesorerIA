import { randomUUID } from "node:crypto";
import { shortMessage } from "@tesoreria/agent";
import { agentContext, agentInFlight, txStatus } from "../../../../lib/agent-context";
import { runAgent } from "../../../../lib/agent-runner";
import { celoClient } from "../../../../lib/chain";
import { currentUser } from "../../../../lib/current-user";
import { getDb } from "../../../../lib/db/client";
import { acquireLock, lockTimeLeft } from "../../../../lib/db/lock";
import { fundsOf } from "../../../../lib/funds";
import { jsonError } from "../../../../lib/http";
import { localeOf } from "../../../../lib/i18n/locales";
import { messagesFor } from "../../../../lib/i18n/messages";
import { lastOperationBlock } from "../../../../lib/operations";
import { waitForBlock } from "../../../../lib/read-your-writes";
import { chainWeekSummaryDeps, writeWeekSummaries } from "../../../../lib/week-summaries";

export const maxDuration = 300;

const COOLDOWN = "agent-run-cooldown";

/**
 * A run right after a member's operation, so the agent acts without waiting for the heartbeat (spec, 8.3). It runs
 * as a heartbeat, under the same lock, so it writes the week summaries too when it is the run that gets the lock
 * (spec, 9.4: whichever run holds the lock writes them).
 */
export async function POST(request: Request) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const db = await getDb();
  if (!(await fundsOf(db, user.id)).some((f) => f.status === "live")) return jsonError(403, m.errors.notInAFund);
  // At most once a minute, whoever asks: the lock is never released, it just expires. Retry-After says when, so the
  // browser asks once more then and the operation doesn't wait for the heartbeat.
  if (!(await acquireLock(db, COOLDOWN, randomUUID(), 60_000))) {
    const response = jsonError(429, m.errors.agentJustRan);
    response.headers.set("retry-after", String(Math.max(1, Math.ceil((await lockTimeLeft(db, COOLDOWN)) / 1000))));
    return response;
  }
  // Read-your-writes: the run reads the chain after the operation that called it (spec, 8.3), or it can miss the
  // USDT that operation brought and leave it to the next heartbeat.
  const mine = await lastOperationBlock(db, user.id);
  if (mine !== null) await waitForBlock(celoClient(), mine);
  try {
    const run = await runAgent(db, (onSent) => agentContext(db, onSent), {
      heartbeat: true,
      txStatus,
      inFlight: agentInFlight,
      afterHeartbeat: () => writeWeekSummaries(db, chainWeekSummaryDeps()),
    });
    return Response.json({ ran: run.ran }, { status: 202 });
  } catch (error) {
    // The browser fires this and forgets it; the next heartbeat does what this run would have.
    console.error(`The run after a contribution could not run the agent: ${shortMessage(error)}`);
    return Response.json({ ran: false, reason: "agent unavailable" }, { status: 202 });
  }
}
