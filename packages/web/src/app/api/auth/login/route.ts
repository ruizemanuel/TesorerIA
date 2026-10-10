import { z } from "zod";
import { logIn } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db/client";
import { env } from "../../../../lib/env";
import { jsonError, readJson } from "../../../../lib/http";
import { hexSchema } from "../../../../lib/schemas";
import { getSession } from "../../../../lib/session";

// Hex strings only: the code that decodes them never sees anything else.
const Assertion = z.object({
  credentialId: z.string().min(1).max(1024),
  authenticatorData: hexSchema,
  clientDataJSON: z.string().max(4096),
  signature: hexSchema,
});

export async function POST(request: Request) {
  const body = await readJson(request, Assertion);
  if (!body.ok) return body.response;
  const { RP_ID, ORIGIN } = env();
  const result = await logIn({
    db: await getDb(),
    session: await getSession(),
    assertion: body.value,
    rpId: RP_ID,
    origin: ORIGIN,
  });
  return result.ok ? Response.json({ ok: true }) : jsonError(result.status, result.error);
}
