import { shortMessage } from "@tesoreria/agent";
import { createForkBundler } from "@tesoreria/wallet/fork";
import { agentAddress } from "../../../lib/agent-address";
import { type BundlerRequest, authorizeBundlerRequest, checkBundlerAnswer } from "../../../lib/bundler-proxy";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { env } from "../../../lib/env";
import { hexSchema } from "../../../lib/schemas";

const shared = globalThis as { tesoreriaForkBundler?: ReturnType<typeof createForkBundler> };

type Answer = { status: number; text: string };

function rpcError(id: unknown, status: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message } }, { status });
}

/** One JSON-RPC request to the bundler: the fork's stand-in on the fork, Pimlico (with the key) otherwise. */
async function ask(request: BundlerRequest): Promise<Answer> {
  const { CHAIN_MODE, CELO_RPC_URL, PIMLICO_API_KEY, PIMLICO_SPONSORSHIP_POLICY_ID } = env();
  if (CHAIN_MODE === "fork") {
    shared.tesoreriaForkBundler ??= createForkBundler({ rpcUrl: CELO_RPC_URL });
    try {
      const result = await shared.tesoreriaForkBundler.request(request);
      return { status: 200, text: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
    } catch (error) {
      return { status: 200, text: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: shortMessage(error) } }) };
    }
  }
  if (PIMLICO_API_KEY === undefined || PIMLICO_SPONSORSHIP_POLICY_ID === undefined) {
    return { status: 503, text: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32600, message: "The bundler isn't configured" } }) };
  }
  const response = await fetch(`https://api.pimlico.io/v2/42220/rpc?apikey=${encodeURIComponent(PIMLICO_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, text: await response.text() };
}

/** Pimlico's current "fast" maxFeePerGas, which a sponsored operation's fee is held to (see `checkSponsoredGas`). */
async function fastMaxFeePerGas(): Promise<bigint> {
  const { status, text } = await ask({ jsonrpc: "2.0", id: 1, method: "pimlico_getUserOperationGasPrice", params: [] });
  if (status !== 200) throw new Error(`gas price: ${status}`);
  const price = hexSchema.parse((JSON.parse(text) as { result?: { fast?: { maxFeePerGas?: unknown } } }).result?.fast?.maxFeePerGas);
  return BigInt(price);
}

/** The only door to Pimlico (spec, 6). The API key never leaves the server. */
export async function POST(request: Request) {
  const user = await currentUser();
  const body: unknown = await request.json().catch(() => undefined);
  const { CHAIN_MODE, PIMLICO_SPONSORSHIP_POLICY_ID, CREATE_FUND_DAILY_LIMIT } = env();
  const check = await authorizeBundlerRequest(
    await getDb(),
    user,
    body,
    PIMLICO_SPONSORSHIP_POLICY_ID ?? "fork",
    CHAIN_MODE === "fork" ? null : fastMaxFeePerGas, // the fork has no paymaster to protect
    // The agent deployCall names: a createFund that names another isn't sponsored. Passed uncalled: it throws when
    // AGENT_PRIVATE_KEY is wrong, and only a creator's request needs it.
    agentAddress,
    CREATE_FUND_DAILY_LIMIT,
  );
  if (!check.ok) return rpcError((body as { id?: unknown } | undefined)?.id, check.status, check.error);
  let answer: Answer;
  try {
    answer = await ask(check.request);
  } catch {
    return rpcError(check.request.id, 502, "The bundler didn't answer"); // nothing of the failed request (its URL carries the key) goes back
  }
  const checked = checkBundlerAnswer(check.request.method, answer.text);
  if (!checked.ok) return rpcError(check.request.id, checked.status, checked.error);
  return new Response(answer.text, { status: answer.status, headers: { "content-type": "application/json" } });
}
