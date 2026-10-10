import { shortMessage } from "@tesoreria/agent";
import { createForkBundler } from "@tesoreria/wallet/fork";
import { authorizeBundlerRequest } from "../../../lib/bundler-proxy";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { env } from "../../../lib/env";

const shared = globalThis as { tesoreriaForkBundler?: ReturnType<typeof createForkBundler> };

function rpcError(id: unknown, status: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message } }, { status });
}

/** The only door to Pimlico (spec, 6). The API key never leaves the server. */
export async function POST(request: Request) {
  const user = await currentUser();
  const body: unknown = await request.json().catch(() => undefined);
  const { CHAIN_MODE, CELO_RPC_URL, PIMLICO_API_KEY, PIMLICO_SPONSORSHIP_POLICY_ID } = env();
  const check = await authorizeBundlerRequest(await getDb(), user, body, PIMLICO_SPONSORSHIP_POLICY_ID ?? "fork");
  if (!check.ok) return rpcError((body as { id?: unknown } | undefined)?.id, check.status, check.error);
  const { id } = check.request;

  if (CHAIN_MODE === "fork") {
    shared.tesoreriaForkBundler ??= createForkBundler({ rpcUrl: CELO_RPC_URL });
    try {
      return Response.json({ jsonrpc: "2.0", id, result: await shared.tesoreriaForkBundler.request(check.request) });
    } catch (error) {
      return Response.json({ jsonrpc: "2.0", id, error: { code: -32603, message: shortMessage(error) } });
    }
  }
  if (PIMLICO_API_KEY === undefined || PIMLICO_SPONSORSHIP_POLICY_ID === undefined) {
    return rpcError(id, 503, "The bundler isn't configured");
  }
  try {
    const response = await fetch(`https://api.pimlico.io/v2/42220/rpc?apikey=${encodeURIComponent(PIMLICO_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(check.request),
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch {
    return rpcError(id, 502, "The bundler didn't answer"); // nothing of the failed request (its URL carries the key) goes back
  }
}
