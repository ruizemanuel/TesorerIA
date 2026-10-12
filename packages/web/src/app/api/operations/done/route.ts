import { z } from "zod";
import { currentUser } from "../../../../lib/current-user";
import { getDb } from "../../../../lib/db/client";
import { jsonError, readJson } from "../../../../lib/http";
import { finishOperation } from "../../../../lib/operations";
import { hashSchema } from "../../../../lib/schemas";

const Done = z.object({
  userOpHash: hashSchema,
  transactionHash: hashSchema,
  success: z.boolean(),
  /** The receipt's block, in decimal. A page loaded before it was asked for doesn't send it. */
  blockNumber: z
    .string()
    .regex(/^\d{1,78}$/)
    .optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) return jsonError(401, "Entrá con tu passkey.");
  const body = await readJson(request, Done);
  if (!body.ok) return body.response;
  const { blockNumber, ...done } = body.value;
  await finishOperation(await getDb(), user.id, { ...done, block: blockNumber === undefined ? undefined : BigInt(blockNumber) });
  return Response.json({ ok: true });
}
