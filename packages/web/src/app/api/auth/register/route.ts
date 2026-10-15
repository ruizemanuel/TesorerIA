import { z } from "zod";
import { deriveAccount } from "../../../../lib/accounts";
import { registerMember } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db/client";
import { env } from "../../../../lib/env";
import { jsonError, readJson } from "../../../../lib/http";
import { localeOf } from "../../../../lib/i18n/locales";
import { messagesFor } from "../../../../lib/i18n/messages";
import { hexSchema } from "../../../../lib/schemas";
import { getSession } from "../../../../lib/session";

const Registration = z.object({
  name: z.string().max(200), // the logic answers with the friendly message from 31 letters up
  email: z.string().max(254).optional(),
  credentialId: z.string().min(1).max(1024),
  publicKey: hexSchema,
  userHandle: hexSchema,
  clientDataJSON: z.string().max(4096),
});

export async function POST(request: Request) {
  const m = messagesFor(localeOf(request));
  const body = await readJson(request, Registration);
  if (!body.ok) return body.response;
  const result = await registerMember({
    db: await getDb(),
    session: await getSession(),
    input: body.value,
    deriveAccount,
    origin: env().ORIGIN,
    m,
  });
  return result.ok ? Response.json({ ok: true }) : jsonError(result.status, result.error);
}
