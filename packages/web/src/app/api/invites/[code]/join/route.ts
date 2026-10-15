import { z } from "zod";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { joinFund } from "../../../../../lib/funds";
import { jsonError, readJson } from "../../../../../lib/http";
import { localeOf } from "../../../../../lib/i18n/locales";
import { messagesFor } from "../../../../../lib/i18n/messages";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const body = await readJson(request, z.object({})); // nothing to read: JSON only, like every route that acts (see readJson)
  if (!body.ok) return body.response;
  const result = await joinFund(await getDb(), user.id, (await params).code, m);
  return result.ok ? Response.json(result) : jsonError(result.status, result.error);
}
