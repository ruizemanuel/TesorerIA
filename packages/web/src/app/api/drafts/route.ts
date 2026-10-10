import { z } from "zod";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { parsePesos } from "../../../lib/format";
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
  const weeklyFee = parsePesos(body.value.weeklyFee);
  const weeklyCap = parsePesos(body.value.weeklyCap);
  if (weeklyFee === null) return jsonError(400, "No entendimos la cuota. Escribila como 10.000 o 10.000,50.");
  if (weeklyCap === null) return jsonError(400, "No entendimos el tope. Escribilo como 60.000 o 60.000,50.");
  const result = await createDraft(await getDb(), user.id, { ...body.value, weeklyFee, weeklyCap });
  return result.ok ? Response.json({ id: result.id }) : jsonError(result.status, result.error);
}
