import { z } from "zod";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { jsonError, readJson } from "../../../lib/http";
import { ownsDraft, recordOperation } from "../../../lib/operations";
import { addressSchema, hashSchema } from "../../../lib/schemas";

const Operation = z
  .object({
    userOpHash: hashSchema,
    kind: z.enum(["create-fund", "contribute", "vote"]),
    fund: addressSchema.optional(),
    /** The draft a `create-fund` deploys. */
    draftId: z.uuid().optional(),
    amount: z
      .string()
      .regex(/^\d{1,78}$/)
      .optional(),
    token: z.enum(["wars", "usdt"]).optional(),
    /** Its EntryPoint nonce, in decimal. */
    nonce: z
      .string()
      .regex(/^\d{1,78}$/)
      .optional(),
  })
  .refine(({ draftId, kind }) => draftId === undefined || kind === "create-fund");

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) return jsonError(401, "Entrá con tu passkey.");
  const body = await readJson(request, Operation);
  if (!body.ok) return body.response;
  const { amount, nonce, ...rest } = body.value;
  const db = await getDb();
  if (rest.draftId !== undefined && !(await ownsDraft(db, user.id, rest.draftId))) {
    return jsonError(403, "Ese borrador no es tuyo.");
  }
  await recordOperation(db, user.id, {
    ...rest,
    amount: amount === undefined ? undefined : BigInt(amount),
    nonce: nonce === undefined ? undefined : BigInt(nonce),
  });
  return Response.json({ ok: true });
}
