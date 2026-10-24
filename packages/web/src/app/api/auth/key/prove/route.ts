import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { env } from "../../../../../lib/env";
import { jsonError, readJson } from "../../../../../lib/http";
import { localeOf } from "../../../../../lib/i18n/locales";
import { messagesFor } from "../../../../../lib/i18n/messages";
import { proveKeyChange } from "../../../../../lib/key-change";
import { assertionSchema } from "../../../../../lib/schemas";
import { getSession } from "../../../../../lib/session";

/** The member's pending passkey answers this session's challenge, so a key change resumed here can go on (spec, 9.5). */
export async function POST(request: Request) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const body = await readJson(request, assertionSchema);
  if (!body.ok) return body.response;
  const result = await proveKeyChange({
    db: await getDb(),
    session: await getSession(),
    user,
    assertion: body.value,
    origin: env().ORIGIN,
    m,
  });
  return result.ok ? Response.json({ ok: true }) : jsonError(result.status, result.error);
}
