import type { Address } from "viem";
import { z } from "zod";
import type { CountryCode } from "../../../lib/countries";
import { currentUser } from "../../../lib/current-user";
import { type Db, getDb } from "../../../lib/db/client";
import { draftCountryOf, fundCountryOf } from "../../../lib/fund-country";
import { jsonError, readJson } from "../../../lib/http";
import { messagesOf } from "../../../lib/i18n/request";
import { ownsDraft, recordOperation } from "../../../lib/operations";
import { addressSchema, hashSchema } from "../../../lib/schemas";

const Operation = z
  .object({
    userOpHash: hashSchema,
    kind: z.enum(["create-fund", "contribute", "vote", "execute", "cash-out", "propose", "key-change"]),
    fund: addressSchema.optional(),
    /** The draft a `create-fund` deploys. */
    draftId: z.uuid().optional(),
    amount: z
      .string()
      .regex(/^\d{1,78}$/)
      .optional(),
    token: z.enum(["wars", "usdt"]).optional(),
    /** For `create-fund`: its EntryPoint nonce (key 0), in decimal. */
    nonce: z
      .string()
      .regex(/^\d{1,78}$/)
      .optional(),
  })
  .refine(({ draftId, kind }) => draftId === undefined || kind === "create-fund")
  // A pass to pesos leaves the member's own account, and a key change swaps its passkey: they belong to no fund.
  .refine(({ fund, kind }) => fund === undefined || (kind !== "cash-out" && kind !== "key-change"));

/**
 * The country the route answers in once it has the operation (spec, 6): its fund's, its draft's for a create-fund, or
 * else the request's.
 */
async function countryOf(db: Db, { fund, draftId }: { fund?: Address; draftId?: string }): Promise<CountryCode | undefined> {
  if (fund !== undefined) return fundCountryOf(db, fund);
  return draftId === undefined ? undefined : draftCountryOf(db, draftId);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) return jsonError(401, messagesOf(request).errors.logIn);
  const body = await readJson(request, Operation);
  if (!body.ok) return body.response;
  const { amount, nonce, ...rest } = body.value;
  const db = await getDb();
  if (rest.draftId !== undefined && !(await ownsDraft(db, user.id, rest.draftId))) {
    return jsonError(403, messagesOf(request, await countryOf(db, rest)).errors.notYourDraft);
  }
  await recordOperation(db, user.id, {
    ...rest,
    amount: amount === undefined ? undefined : BigInt(amount),
    nonce: nonce === undefined ? undefined : BigInt(nonce),
  });
  return Response.json({ ok: true });
}
