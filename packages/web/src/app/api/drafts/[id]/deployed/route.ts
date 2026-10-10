import { z } from "zod";
import { agentAddress } from "../../../../../lib/agent-address";
import { celoClient } from "../../../../../lib/chain";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { confirmDeploy } from "../../../../../lib/funds";
import { jsonError, readJson } from "../../../../../lib/http";
import { hashSchema } from "../../../../../lib/schemas";

const Deployed = z.object({ transactionHash: hashSchema });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (user === null) return jsonError(401, "Entrá con tu passkey.");
  const body = await readJson(request, Deployed);
  if (!body.ok) return body.response;
  const result = await confirmDeploy(await getDb(), {
    fundId: (await params).id,
    userId: user.id,
    transactionHash: body.value.transactionHash,
    client: celoClient(),
    agent: agentAddress(),
  });
  return result.ok ? Response.json({ address: result.address }) : jsonError(result.status, result.error);
}
