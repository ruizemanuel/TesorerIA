import { shortMessage } from "@tesoreria/agent";
import { readSafeKey } from "@tesoreria/wallet";
import { and, eq } from "drizzle-orm";
import { quickCeloClient } from "../../../lib/chain";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { credentials } from "../../../lib/db/schema";
import { env } from "../../../lib/env";
import { jsonError } from "../../../lib/http";
import { localeOf } from "../../../lib/i18n/locales";
import { messagesFor } from "../../../lib/i18n/messages";
import { confirmKeyChange, keyChangeOf } from "../../../lib/key-change";
import { getSession } from "../../../lib/session";

/** How long the chain gets to show a pending key change, on a request every action's tap waits on. */
const CHAIN_READ_MS = 3_000;

export async function GET(request: Request) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const db = await getDb();
  // A key change that reached the chain after its page closed is confirmed here (spec, 9.5). Without the chain, or
  // when it takes longer than CHAIN_READ_MS, the answer is the database's as it stands, and the next one tries again.
  try {
    await confirmKeyChange(db, user, (account) => readSafeKey(quickCeloClient(CHAIN_READ_MS), account));
  } catch (error) {
    console.error(`/api/me could not confirm a key change: ${shortMessage(error)}`);
  }
  // The passkey whose key the Safe holds, which the browser signs with: the active one, never the pending one.
  const [credential] = await db
    .select({ id: credentials.id, publicKey: credentials.publicKey, rpId: credentials.rpId })
    .from(credentials)
    .where(and(eq(credentials.userId, user.id), eq(credentials.state, "active")));
  if (credential === undefined) {
    // Nothing can sign for them until one is: a key change cut halfway, which a later confirmation may finish.
    console.error(`/api/me: ${user.id} has no active passkey`);
    return jsonError(503, m.errors.generic);
  }
  const { RP_ID, KEY_CHANGE_PILOT } = env();
  const keyChange = await keyChangeOf(db, user, await getSession(), { rpId: RP_ID, pilot: KEY_CHANGE_PILOT });
  return Response.json({ name: user.name, account: user.account, credential, keyChange });
}
