import { z } from "zod";
import { readDraft } from "../../../lib/checks";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { createDraft } from "../../../lib/funds";
import { jsonError, readJson } from "../../../lib/http";

// Generous caps: the logic answers with the friendly message (40 letters) well before these.
const Draft = z.object({
  name: z.string().max(200),
  agreedExpense: z.string().max(200),
  weeklyFee: z.string().max(100),
  weeklyCap: z.string().max(100),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) return jsonError(401, "Entrá con tu passkey.");
  const body = await readJson(request, Draft);
  if (!body.ok) return body.response;
  const read = readDraft(body.value); // the same checks the form ran before making the passkey
  if (!read.ok) return jsonError(400, read.error);
  const result = await createDraft(await getDb(), user.id, read.draft);
  return result.ok ? Response.json({ id: result.id }) : jsonError(result.status, result.error);
}
