import { readSafeKey } from "@tesoreria/wallet";
import { celoClient } from "../../../../../lib/chain";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { jsonError } from "../../../../../lib/http";
import { localeOf } from "../../../../../lib/i18n/locales";
import { messagesFor } from "../../../../../lib/i18n/messages";
import { confirmKeyChange } from "../../../../../lib/key-change";

/** The member's key change, confirmed from the chain (spec, 9.5): `result` is "changed", "waiting" or "none". */
export async function POST(request: Request) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const result = await confirmKeyChange(await getDb(), user, (account) => readSafeKey(celoClient(), account));
  return Response.json({ result });
}
