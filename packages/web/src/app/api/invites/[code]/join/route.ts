import { z } from "zod";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { countryCodeOf } from "../../../../../lib/fund-country";
import { draftByInvite, joinFund } from "../../../../../lib/funds";
import { jsonError, readJson } from "../../../../../lib/http";
import { messagesOf } from "../../../../../lib/i18n/request";

/** Joins the fund an invitation is to, or asks to join it once it's live (joinFund). In the fund's country (spec, 6). */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await currentUser();
  if (user === null) return jsonError(401, messagesOf(request).errors.logIn);
  const body = await readJson(request, z.object({})); // nothing to read: JSON only, like every route that acts (see readJson)
  if (!body.ok) return body.response;
  const db = await getDb();
  const { code } = await params;
  const draft = await draftByInvite(db, code);
  const result = await joinFund(db, user.id, code, messagesOf(request, draft === null ? undefined : countryCodeOf(draft.currency)));
  return result.ok ? Response.json(result) : jsonError(result.status, result.error);
}
