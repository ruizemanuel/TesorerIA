import { shortMessage } from "@tesoreria/agent";
import { createForkBundler } from "@tesoreria/wallet/fork";
import { agentAddress } from "../../../lib/agent-address";
import {
  type BundlerRequest,
  authorizeBundlerRequest,
  checkBundlerAnswer,
  isKeyChangeSend,
  keyChangeCallKey,
  refusedByBundler,
  userOperationHash,
} from "../../../lib/bundler-proxy";
import { type CurrentUser, currentUser } from "../../../lib/current-user";
import { type Db, getDb } from "../../../lib/db/client";
import { withLock } from "../../../lib/db/lock";
import { env } from "../../../lib/env";
import { KEY_CHANGE_LOCK_TTL_MS, keyChangeKeyFor, keyChangeLock } from "../../../lib/key-change";
import { recordOperation, recordRefused } from "../../../lib/operations";
import { hexSchema } from "../../../lib/schemas";
import { getSession } from "../../../lib/session";

const shared = globalThis as { tesoreriaForkBundler?: ReturnType<typeof createForkBundler> };

type Answer = { status: number; text: string };

function rpcError(id: unknown, status: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message } }, { status });
}

/** How long Pimlico gets to answer; a key change's lock (KEY_CHANGE_LOCK_TTL_MS) outlasts it. */
const PIMLICO_TIMEOUT_MS = 30_000;

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
    signal: AbortSignal.timeout(PIMLICO_TIMEOUT_MS),
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
  const db = await getDb();
  const check = await authorizeBundlerRequest(
    db,
    // The only key change sponsored: to the pending passkey this session made or proved it holds (spec, 9.5).
    user === null ? null : { id: user.id, account: user.account, keyChangeKey: await keyChangeKeyFor(db, user, await getSession()) },
    body,
    PIMLICO_SPONSORSHIP_POLICY_ID ?? "fork",
    CHAIN_MODE === "fork" ? null : fastMaxFeePerGas, // the fork has no paymaster to protect
    // The agent deployCall names: a createFund that names another isn't sponsored. Passed uncalled: it throws when
    // AGENT_PRIVATE_KEY is wrong, and only a creator's request needs it.
    agentAddress,
    CREATE_FUND_DAILY_LIMIT,
  );
  if (!check.ok) return rpcError((body as { id?: unknown } | undefined)?.id, check.status, check.error);
  if (user !== null && isKeyChangeSend(check.request)) return forwardKeyChange(db, user, check.request);
  return forward(check.request);
}

/** Asks the bundler, and passes its answer on once `checkBundlerAnswer` lets it. */
async function forward(request: BundlerRequest, answered?: (answer: Answer) => Promise<void>): Promise<Response> {
  let answer: Answer;
  try {
    answer = await ask(request);
  } catch {
    return rpcError(request.id, 502, "The bundler didn't answer"); // nothing of the failed request (its URL carries the key) goes back
  }
  await answered?.(answer);
  const checked = checkBundlerAnswer(request.method, answer.text);
  if (!checked.ok) return rpcError(request.id, checked.status, checked.error);
  return new Response(answer.text, { status: answer.status, headers: { "content-type": "application/json" } });
}

/**
 * Sends a key change to the bundler (spec, 9.5) holding the person's key change lock (`keyChangeLock`), which a start
 * of theirs takes too, so the pending passkey can't be replaced between the check that this session may swap to it
 * and the swap going out. Inside it, that check is made again, and the operation is recorded, under the hash
 * EntryPoint v0.7 gives it, before it leaves: from then on it counts as on its way, whatever becomes of the answer,
 * and the pending passkey is kept. The bundler's answer then settles it only if it refuses the operation outright,
 * and only if this request is the one that recorded it: otherwise the same operation went out before, and may land.
 * No answer leaves it on its way. Without the lock, or without the record, nothing is sent.
 */
async function forwardKeyChange(db: Db, user: CurrentUser, request: BundlerRequest): Promise<Response> {
  const userOp = request.params[0] as { callData: string };
  const userOpHash = userOperationHash(userOp);
  if (userOpHash === null) return rpcError(request.id, 400, "The operation can't be hashed");
  const locked = await withLock(db, keyChangeLock(user.id), KEY_CHANGE_LOCK_TTL_MS, async () => {
    const keyChangeKey = await keyChangeKeyFor(db, user, await getSession());
    if (keyChangeKey === null || keyChangeCallKey(userOp.callData) !== keyChangeKey.toLowerCase()) {
      return rpcError(request.id, 403, "Only a key change to the passkey this session made or proved is sponsored"); // replaced meanwhile
    }
    let recorded: boolean;
    try {
      recorded = await recordOperation(db, user.id, { userOpHash, kind: "key-change" });
    } catch (error) {
      console.error(`/api/bundler could not record the key change ${userOpHash}: ${shortMessage(error)}`);
      return rpcError(request.id, 503, "The key change couldn't be recorded: try again");
    }
    return forward(request, async (answer) => {
      if (!recorded || !refusedByBundler(answer)) return;
      try {
        await recordRefused(db, user.id, userOpHash);
      } catch (error) {
        console.error(`/api/bundler could not record that the bundler refused the key change ${userOpHash}: ${shortMessage(error)}`);
      }
    });
  });
  return locked.ran ? locked.value : rpcError(request.id, 503, "Another key change of this account is being handled: try again");
}
