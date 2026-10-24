import { readSafeKey } from "@tesoreria/wallet";
import { z } from "zod";
import { quickCeloClient } from "../../../../lib/chain";
import { currentUser } from "../../../../lib/current-user";
import { getDb } from "../../../../lib/db/client";
import { env } from "../../../../lib/env";
import { jsonError, readJson } from "../../../../lib/http";
import { localeOf } from "../../../../lib/i18n/locales";
import { messagesFor } from "../../../../lib/i18n/messages";
import { startKeyChange } from "../../../../lib/key-change";
import { attestationSchema, hexSchema } from "../../../../lib/schemas";
import { getSession } from "../../../../lib/session";

/**
 * How long the chain gets to show a pending key, read while the start holds the person's key-change lock: well inside
 * KEY_CHANGE_LOCK_TTL_MS, so the lock can't expire and let a send in between the read and the replace.
 */
const CHAIN_READ_MS = 15_000;

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
  const { RP_ID, KEY_CHANGE_PILOT, ORIGIN } = env();
  const result = await startKeyChange({
    db: await getDb(),
    session: await getSession(),
    user,
    input: body.value,
    rpId: RP_ID,
    pilot: KEY_CHANGE_PILOT, // due only for them while it's set, as /api/me says
    origin: ORIGIN,
    readKey: (account) => readSafeKey(quickCeloClient(CHAIN_READ_MS), account),
    m,
  });
  return result.ok ? Response.json({ publicKey: result.publicKey }) : jsonError(result.status, result.error);
}
