import { z } from "zod";
import { agentAddress } from "../../../../../lib/agent-address";
import { celoClient, userOperationFinder } from "../../../../../lib/chain";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { env } from "../../../../../lib/env";
import { cancelDeploy, deployStep } from "../../../../../lib/funds";
import { jsonError, readJson } from "../../../../../lib/http";
import { localeOf } from "../../../../../lib/i18n/locales";
import { messagesFor } from "../../../../../lib/i18n/messages";

/** "Crear fondo": the fund if it's already there, the operation to check if one is on its way, or the call to sign (with the nonce to pin it to, for a resend). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const body = await readJson(request, z.object({ votesRequired: z.number().int() }));
  if (!body.ok) return body.response;
  const result = await deployStep(await getDb(), {
    fundId: (await params).id,
    userId: user.id,
    votesRequired: body.value.votesRequired,
    agent: agentAddress(),
    client: celoClient(),
    findOperation: userOperationFinder(celoClient()),
    createFundDailyLimit: env().CREATE_FUND_DAILY_LIMIT,
    m,
  });
  if (!result.ok) return jsonError(result.status, result.error);
  // A pinned nonce goes as a decimal string: JSON has no bigint.
  return Response.json("call" in result ? { ok: true, call: result.call, nonce: result.nonce?.toString() } : result);
}

/**
 * The deploy didn't go out, or failed: people can join again. A cross-site form can't send a DELETE, and a
 * cross-site fetch carries no cookie (sameSite lax), so it needs no JSON body to be safe.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const result = await cancelDeploy(await getDb(), { fundId: (await params).id, userId: user.id, m });
  return result.ok ? Response.json({ reopened: result.reopened }) : jsonError(result.status, result.error);
}
