import { desc, eq } from "drizzle-orm";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { credentials } from "../../../lib/db/schema";
import { jsonError } from "../../../lib/http";
import { localeOf } from "../../../lib/i18n/locales";
import { messagesFor } from "../../../lib/i18n/messages";

export async function GET(request: Request) {
  const m = messagesFor(localeOf(request));
  const user = await currentUser();
  if (user === null) return jsonError(401, m.errors.logIn);
  const db = await getDb();
  const [credential] = await db
    .select({ id: credentials.id, publicKey: credentials.publicKey })
    .from(credentials)
    .where(eq(credentials.userId, user.id))
    .orderBy(desc(credentials.createdAt))
    .limit(1);
  return Response.json({ name: user.name, account: user.account, credential });
}
