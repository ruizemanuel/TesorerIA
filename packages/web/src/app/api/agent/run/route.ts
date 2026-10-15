import { randomUUID } from "node:crypto";
import { shortMessage } from "@tesoreria/agent";
import { agentContext, agentInFlight, txStatus } from "../../../../lib/agent-context";
import { runAgent } from "../../../../lib/agent-runner";
import { celoClient } from "../../../../lib/chain";
import { currentUser } from "../../../../lib/current-user";
import { getDb } from "../../../../lib/db/client";
import { acquireLock } from "../../../../lib/db/lock";
import { fundsOf } from "../../../../lib/funds";
import { jsonError } from "../../../../lib/http";
import { localeOf } from "../../../../lib/i18n/locales";
import { messagesFor } from "../../../../lib/i18n/messages";
import { lastOperationBlock } from "../../../../lib/operations";
import { waitForBlock } from "../../../../lib/read-your-writes";

export const maxDuration = 300;

/** A run right after a member's operation, so the agent acts without waiting for the heartbeat (spec, 8.3). */
export async function POST(request: Request) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const db = await getDb();
  if (!(await fundsOf(db, user.id)).some((f) => f.status === "live")) return jsonError(403, m.errors.notInAFund);
  // At most once a minute, whoever asks: the lock is never released, it just expires.
  if (!(await acquireLock(db, "agent-run-cooldown", randomUUID(), 60_000))) return jsonError(429, m.errors.agentJustRan);
  // Read-your-writes: the run reads the chain after the operation that called it (spec, 8.3), or it can miss the
  // USDT that operation brought and leave it to the next heartbeat.
  const mine = await lastOperationBlock(db, user.id);
  if (mine !== null) await waitForBlock(celoClient(), mine);
  try {
    const run = await runAgent(db, (onSent) => agentContext(db, onSent), { heartbeat: true, txStatus, inFlight: agentInFlight });
    return Response.json({ ran: run.ran }, { status: 202 });
  } catch (error) {
    // The browser fires this and forgets it; the next heartbeat does what this run would have.
    console.error(`The run after a contribution could not run the agent: ${shortMessage(error)}`);
    return Response.json({ ran: false, reason: "agent unavailable" }, { status: 202 });
  }
}
