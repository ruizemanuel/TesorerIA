import { ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
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
/** The methods whose operation must end with TesorerIA's attribution tag (ERC-8021): what's sent, and what's signed. */
const TAGGED = new Set(["eth_sendUserOperation", "pm_getPaymasterData"]);
const CELO = numberToHex(42220);

/** Whether the operation's callData ends with TesorerIA's attribution suffix, which every operation the web makes carries. */
function isTagged(userOp: unknown): boolean {
  const callData = typeof userOp === "object" && userOp !== null ? (userOp as { callData?: unknown }).callData : undefined;
  return typeof callData === "string" && callData.toLowerCase().endsWith(ATTRIBUTION_SUFFIX.slice(2).toLowerCase());
}

export type BundlerRequest = { jsonrpc: "2.0"; id: number | string | null; method: string; params: unknown[] };
export type BundlerCheck = { ok: true; request: BundlerRequest } | { ok: false; status: 400 | 401 | 403 | 502; error: string };

/**
 * What /api/bundler forwards, rebuilt from scratch (spec, 6): only the flow's methods, only operations from
 * `account` (the logged-in member's Safe), only EntryPoint v0.7 on Celo, only operations that carry the attribution
 * tag to be signed or sent, and the paymaster's context replaced by the server's sponsorship policy. Anything else
 * never reaches Pimlico.
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
  if (TAGGED.has(method) && !isTagged(userOp)) return { ok: false, status: 400, error: "The operation must end with TesorerIA's attribution tag" };
  if (method.startsWith("pm_")) {
    // ERC-7677: [userOp, entryPoint, chainId, context]. The policy is always the server's.
    if (params[2] !== CELO) return { ok: false, status: 400, error: "Celo only" };
    return { ok: true, request: { jsonrpc: "2.0", id, method, params: [userOp, entryPoint, CELO, { sponsorshipPolicyId }] } };
  }
  return { ok: true, request: { jsonrpc: "2.0", id, method, params: [userOp, entryPoint] } };
}

/** The operation's fee may be this many times Pimlico's current "fast" price: the client prices at "fast", the rest is room for the price to move before the paymaster signs. */
export const MAX_FEE_MULTIPLE = 2n;
/** The heaviest flow (a first Safe deployment plus FundFactory.createFund) used 3.8M gas on the fork; this leaves room and still caps what one operation can take from the paymaster. */
export const MAX_OPERATION_GAS = 10_000_000n;

const QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * What the paymaster signs when it sponsors (pm_getPaymasterData) is the operation with its fees and gas limits,
 * so those are bounded here: a member can't get a signature for an operation that overpays its bundler (itself,
 * if it submits the operation) out of the paymaster's deposit. `fastMaxFeePerGas` is Pimlico's current price.
 */
export function checkSponsoredGas(userOp: unknown, fastMaxFeePerGas: bigint): { ok: true } | { ok: false; status: 400; error: string } {
  const fields = (typeof userOp === "object" && userOp !== null ? userOp : {}) as Record<string, unknown>;
  const quantity = (name: string, optional = false): bigint | undefined => {
    const value = fields[name];
    if (value === undefined && optional) return 0n;
    return typeof value === "string" && QUANTITY.test(value) ? BigInt(value) : undefined;
  };
  const maxFee = quantity("maxFeePerGas");
  const maxPriorityFee = quantity("maxPriorityFeePerGas");
  const gas = [
    quantity("callGasLimit"),
    quantity("verificationGasLimit"),
    quantity("preVerificationGas"),
    quantity("paymasterVerificationGasLimit", true),
    quantity("paymasterPostOpGasLimit", true),
  ];
  if (maxFee === undefined || maxPriorityFee === undefined || gas.includes(undefined)) {
    return { ok: false, status: 400, error: "Fees and gas limits must be hex quantities" };
  }
  if (maxPriorityFee > maxFee) return { ok: false, status: 400, error: "maxPriorityFeePerGas above maxFeePerGas" };
  if (maxFee > MAX_FEE_MULTIPLE * fastMaxFeePerGas) return { ok: false, status: 400, error: "maxFeePerGas too high" };
  if ((gas as bigint[]).reduce((sum, limit) => sum + limit, 0n) > MAX_OPERATION_GAS) {
    return { ok: false, status: 400, error: "Gas limits too high" };
  }
  return { ok: true };
}

/**
 * `checkBundlerRequest`, and the gas is paid only for people who belong to a draft or live fund (a row in
 * `memberships`): a stranger with an account gets nothing, however well-formed the request.
 *
 * With `fastMaxFeePerGas` (Pimlico's current price, read only when it is needed), a sponsoring request
 * (pm_getPaymasterData) also has to pass `checkSponsoredGas`; if the price can't be read, it is refused with 502
 * rather than signed blind. The fork has no paymaster to protect and passes none.
 */
export async function authorizeBundlerRequest(
  db: Db,
  user: { id: string; account: Address } | null,
  body: unknown,
  sponsorshipPolicyId: string,
  fastMaxFeePerGas?: () => Promise<bigint>,
): Promise<BundlerCheck> {
  const check = checkBundlerRequest(body, user?.account ?? null, sponsorshipPolicyId);
  if (!check.ok || user === null) return check; // without a user the check never passes
  const [membership] = await db.select({ fundId: memberships.fundId }).from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (membership === undefined) return { ok: false, status: 403, error: "Only members of a fund are sponsored" };
  if (fastMaxFeePerGas === undefined || check.request.method !== "pm_getPaymasterData") return check;
  let price: bigint;
  try {
    price = await fastMaxFeePerGas();
  } catch {
    return { ok: false, status: 502, error: "Couldn't read the current gas price" };
  }
  const gas = checkSponsoredGas(check.request.params[0], price);
  return gas.ok ? check : gas;
}
