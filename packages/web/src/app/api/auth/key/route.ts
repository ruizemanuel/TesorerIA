import { z } from "zod";
import { currentUser } from "../../../../lib/current-user";
import { getDb } from "../../../../lib/db/client";
import { env } from "../../../../lib/env";
import { jsonError, readJson } from "../../../../lib/http";
import { localeOf } from "../../../../lib/i18n/locales";
import { messagesFor } from "../../../../lib/i18n/messages";
import { startKeyChange } from "../../../../lib/key-change";
import { attestationSchema, hexSchema } from "../../../../lib/schemas";
import { getSession } from "../../../../lib/session";

// A new passkey as a registration posts it, and never without its attestation.
const KeyChangeStart = z.object({
  credentialId: z.string().min(1).max(1024),
  attestationObject: attestationSchema,
  userHandle: hexSchema,
  clientDataJSON: z.string().max(4096),
});

/** Keeps the passkey the member just made as their pending one (spec, 9.5), and answers its key: the swap's. */
export async function POST(request: Request) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const body = await readJson(request, KeyChangeStart);
  if (!body.ok) return body.response;
  const result = await startKeyChange({
    db: await getDb(),
    session: await getSession(),
    user,
    input: body.value,
    rpId: env().RP_ID,
    origin: env().ORIGIN,
    m,
  });
  return result.ok ? Response.json({ publicKey: result.publicKey }) : jsonError(result.status, result.error);
}
