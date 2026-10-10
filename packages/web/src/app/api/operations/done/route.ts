import { z } from "zod";
import { currentUser } from "../../../../lib/current-user";
import { getDb } from "../../../../lib/db/client";
import { jsonError, readJson } from "../../../../lib/http";
import { dropOperation, finishOperation } from "../../../../lib/operations";
import { hashSchema } from "../../../../lib/schemas";

/** Its receipt, or that the bundler no longer knows it (see `dropOperation`). */
const Done = z.union([
  z.object({ userOpHash: hashSchema, transactionHash: hashSchema, success: z.boolean() }),
  z.object({ userOpHash: hashSchema, dropped: z.literal(true) }),
]);

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) return jsonError(401, "Entrá con tu passkey.");
  const body = await readJson(request, Done);
  if (!body.ok) return body.response;
  const db = await getDb();
  if ("dropped" in body.value) {
    return Response.json({ ok: true, dropped: await dropOperation(db, user.id, body.value.userOpHash) });
  }
  await finishOperation(db, user.id, body.value);
  return Response.json({ ok: true });
}
