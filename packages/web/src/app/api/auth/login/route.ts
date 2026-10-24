import { logIn } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db/client";
import { env } from "../../../../lib/env";
import { jsonError, readJson } from "../../../../lib/http";
import { localeOf } from "../../../../lib/i18n/locales";
import { messagesFor } from "../../../../lib/i18n/messages";
import { assertionSchema } from "../../../../lib/schemas";
import { getSession } from "../../../../lib/session";

export async function POST(request: Request) {
  const m = messagesFor(localeOf(request));
  const body = await readJson(request, assertionSchema);
  if (!body.ok) return body.response;
  const result = await logIn({
    db: await getDb(),
    session: await getSession(),
    assertion: body.value,
    origin: env().ORIGIN,
    m,
  });
  return result.ok ? Response.json({ ok: true }) : jsonError(result.status, result.error);
}
