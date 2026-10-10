import { eq } from "drizzle-orm";
import { type Address, isAddress, isAddressEqual, numberToHex } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import type { Db } from "./db/client";
import { memberships } from "./db/schema";

/** The JSON-RPC methods a member's browser needs to send a sponsored UserOperation, and nothing else. */
export const BUNDLER_METHODS = new Set([
  "eth_chainId",
  "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "pimlico_getUserOperationGasPrice",
  "pm_getPaymasterStubData",
  "pm_getPaymasterData",
]);

/** The methods that carry a UserOperation: [userOp, entryPoint, …]. */
const WITH_USER_OP = new Set(["eth_estimateUserOperationGas", "eth_sendUserOperation", "pm_getPaymasterStubData", "pm_getPaymasterData"]);
const CELO = numberToHex(42220);

export type BundlerRequest = { jsonrpc: "2.0"; id: number | string | null; method: string; params: unknown[] };
export type BundlerCheck = { ok: true; request: BundlerRequest } | { ok: false; status: 400 | 401 | 403; error: string };

/**
 * What /api/bundler forwards, rebuilt from scratch (spec, 6): only the flow's methods, only operations from
 * `account` (the logged-in member's Safe), only EntryPoint v0.7 on Celo, and the paymaster's context replaced
 * by the server's sponsorship policy. Anything else never reaches Pimlico.
 */
export function checkBundlerRequest(body: unknown, account: Address | null, sponsorshipPolicyId: string): BundlerCheck {
  if (account === null) return { ok: false, status: 401, error: "Log in first" };
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "One JSON-RPC request at a time" };
  }
  const { id = null, method, params = [] } = body as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof method !== "string" || !BUNDLER_METHODS.has(method)) {
    return { ok: false, status: 403, error: `Method not allowed: ${String(method)}` };
  }
  if (!Array.isArray(params)) return { ok: false, status: 400, error: "params must be an array" };
  if (typeof id !== "number" && typeof id !== "string" && id !== null) return { ok: false, status: 400, error: "Bad id" };
  if (!WITH_USER_OP.has(method)) return { ok: true, request: { jsonrpc: "2.0", id, method, params } };

  const [userOp, entryPoint] = params as [unknown, unknown];
  const sender = typeof userOp === "object" && userOp !== null ? (userOp as { sender?: unknown }).sender : undefined;
  if (typeof sender !== "string" || !isAddress(sender, { strict: false }) || !isAddressEqual(sender, account)) {
    return { ok: false, status: 403, error: "Only your own account's operations" };
  }
  if (typeof entryPoint !== "string" || !isAddress(entryPoint, { strict: false }) || !isAddressEqual(entryPoint, entryPoint07Address)) {
    return { ok: false, status: 400, error: "EntryPoint v0.7 only" };
  }
  if (method.startsWith("pm_")) {
    // ERC-7677: [userOp, entryPoint, chainId, context]. The policy is always the server's.
    if (params[2] !== CELO) return { ok: false, status: 400, error: "Celo only" };
    return { ok: true, request: { jsonrpc: "2.0", id, method, params: [userOp, entryPoint, CELO, { sponsorshipPolicyId }] } };
  }
  return { ok: true, request: { jsonrpc: "2.0", id, method, params: [userOp, entryPoint] } };
}

/**
 * `checkBundlerRequest`, and the gas is paid only for people who belong to a draft or live fund (a row in
 * `memberships`): a stranger with an account gets nothing, however well-formed the request.
 */
export async function authorizeBundlerRequest(
  db: Db,
  user: { id: string; account: Address } | null,
  body: unknown,
  sponsorshipPolicyId: string,
): Promise<BundlerCheck> {
  const check = checkBundlerRequest(body, user?.account ?? null, sponsorshipPolicyId);
  if (!check.ok || user === null) return check; // without a user the check never passes
  const [membership] = await db.select({ fundId: memberships.fundId }).from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (membership === undefined) return { ok: false, status: 403, error: "Only members of a fund are sponsored" };
  return check;
}
