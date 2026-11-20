import { z } from "zod";
import { agentAddress } from "../../../../../lib/agent-address";
import { celoClient } from "../../../../../lib/chain";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { draftCountryOf } from "../../../../../lib/fund-country";
import { confirmDeploy } from "../../../../../lib/funds";
import { jsonError, readJson } from "../../../../../lib/http";
import { messagesOf } from "../../../../../lib/i18n/request";
import { hashSchema } from "../../../../../lib/schemas";

const Deployed = z.object({ transactionHash: hashSchema });

/** The draft goes live with the fund created in the transaction (confirmDeploy). It answers in the draft's country (spec, 6). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (user === null) return jsonError(401, messagesOf(request).errors.logIn);
  const body = await readJson(request, Deployed);
  if (!body.ok) return body.response;
  const db = await getDb();
  const fundId = (await params).id;
  const result = await confirmDeploy(db, {
    fundId,
    userId: user.id,
    transactionHash: body.value.transactionHash,
    client: celoClient(),
    agent: agentAddress(),
    m: messagesOf(request, await draftCountryOf(db, fundId)),
  });
  return result.ok ? Response.json({ address: result.address }) : jsonError(result.status, result.error);
}
