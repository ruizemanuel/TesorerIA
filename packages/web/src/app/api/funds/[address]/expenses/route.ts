import { shortMessage } from "@tesoreria/agent";
import { and, eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { agentContext, txStatus } from "../../../../../lib/agent-context";
import { runAgent } from "../../../../../lib/agent-runner";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { expenses, funds, memberships } from "../../../../../lib/db/schema";
import { submitExpense } from "../../../../../lib/expenses";
import { parsePesos } from "../../../../../lib/format";
import { jsonError, readJson } from "../../../../../lib/http";

// The agent runs inside the request, like the heartbeat's; its lock outlives this (agent-runner.ts).
export const maxDuration = 300;

// Generous caps: submitExpense answers with the friendly message well before these.
const Expense = z.object({
  clientKey: z.string().max(100),
  kind: z.enum(["agreed", "other"]),
  amount: z.string().max(100),
  note: z.string().max(1000),
  confirmDuplicate: z.boolean().optional(),
});

/** Keeps the expense and hands it to the agent right away (spec, 8.3: "por eventos"). */
export async function POST(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const user = await currentUser();
  if (user === null) return jsonError(401, "Entrá con tu passkey.");
  const { address } = await params;
  if (!isAddress(address, { strict: false })) return jsonError(404, "No encontramos ese fondo.");
  const body = await readJson(request, Expense);
  if (!body.ok) return body.response;
  const amount = parsePesos(body.value.amount);
  if (amount === null) return jsonError(400, "No entendimos el monto. Escribilo como 10.000 o 10.000,50.");

  const db = await getDb();
  const [membership] = await db
    .select({ fundId: funds.id })
    .from(funds)
    .innerJoin(memberships, eq(memberships.fundId, funds.id))
    .where(and(eq(funds.address, getAddress(address)), eq(funds.status, "live"), eq(memberships.userId, user.id)));
  if (membership === undefined) return jsonError(404, "No encontramos ese fondo.");

  const saved = await submitExpense(db, { userId: user.id, fundId: membership.fundId, input: { ...body.value, amount } });
  if (!saved.ok) return jsonError(saved.status, saved.error);
  // The same expense from another tab: the person says first whether it is another one, and nothing runs.
  if (saved.duplicateOf !== undefined) return Response.json({ status: saved.status, duplicateOf: saved.duplicateOf });

  let busy = true;
  try {
    busy = !(await runAgent(db, (onSent) => agentContext(db, onSent), { expenseId: saved.id, txStatus })).ran;
  } catch (error) {
    // The expense is kept and queued, and the next run takes it. An error here would invite loading it again.
    console.error(`The agent could not run for expense ${saved.id}: ${shortMessage(error)}`);
  }
  const [row] = await db.select({ status: expenses.status }).from(expenses).where(eq(expenses.id, saved.id));
  return Response.json({ status: row?.status ?? saved.status, busy });
}
