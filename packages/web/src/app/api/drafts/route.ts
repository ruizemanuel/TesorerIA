import { z } from "zod";
import { readDraft } from "../../../lib/checks";
import { COUNTRY_CODES, DEFAULT_COUNTRY } from "../../../lib/countries";
import { offeredNow } from "../../../lib/countries-env";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { createDraft } from "../../../lib/funds";
import { jsonError, readJson } from "../../../lib/http";
import { messagesOf } from "../../../lib/i18n/request";

// Generous caps: the logic answers with the friendly message (40 letters) well before these.
const Draft = z.object({
  name: z.string().max(200),
  agreedExpense: z.string().max(200),
  weeklyFee: z.string().max(100),
  weeklyCap: z.string().max(100),
  /** The country the group is from, as /crear chose it: a body without one makes an Argentine draft, as before. */
  country: z.enum(COUNTRY_CODES).default(DEFAULT_COUNTRY),
});

/**
 * A new draft in the currency of the country its body names (spec, 9), if this deployment offers it (spec, 13): the
 * only place that asks, so a draft made while a country was offered is joined and created after it isn't.
 */
export async function POST(request: Request) {
  // Until the body says its country, the request's: its IP's, as /crear speaks it when it names none.
  const asked = messagesOf(request);
  const user = await currentUser();
  if (user === null) return jsonError(401, asked.errors.logIn);
  const body = await readJson(request, Draft);
  if (!body.ok) return body.response;
  const { country, ...settings } = body.value;
  if (!offeredNow().includes(country)) return jsonError(400, asked.errors.countryNotOffered);
  // The country's form wrote the amounts its way, and checked them against its currency's cap.
  const m = messagesOf(request, country);
  const read = readDraft(settings, m); // the same checks the form ran before making the passkey
  if (!read.ok) return jsonError(400, read.error);
  const result = await createDraft(await getDb(), user.id, read.draft, m);
  return result.ok ? Response.json({ id: result.id }) : jsonError(result.status, result.error);
}
