import { FUND_FACTORY, USDT, WARS, shortMessage } from "@tesoreria/agent";
import { ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  type Abi,
  type Address,
  type Hex,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  hexToBigInt,
  hexToNumber,
  isAddress,
  isAddressEqual,
  isHex,
  numberToHex,
  parseAbi,
  size,
  slice,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { type Db, inTransaction } from "./db/client";
import { createFundNonces, funds, memberships, users } from "./db/schema";
import { memberFundAbi } from "./fund-abi";
import { frozenCreateFunds } from "./funds";

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

/**
 * The methods that carry a UserOperation ([userOp, entryPoint, …]), and with it the sponsorship: what they estimate,
 * stub, sign or send is paid by the paymaster. The others only read.
 */
const WITH_USER_OP = new Set(["eth_estimateUserOperationGas", "eth_sendUserOperation", "pm_getPaymasterStubData", "pm_getPaymasterData"]);
const CELO = numberToHex(42220);
const SUFFIX = ATTRIBUTION_SUFFIX.slice(2).toLowerCase();

/** Whether the operation's callData ends with TesorerIA's attribution suffix, which every operation the web makes carries. */
function isTagged(userOp: unknown): boolean {
  const callData = typeof userOp === "object" && userOp !== null ? (userOp as { callData?: unknown }).callData : undefined;
  return typeof callData === "string" && callData.toLowerCase().endsWith(SUFFIX);
}

export type BundlerRequest = { jsonrpc: "2.0"; id: number | string | null; method: string; params: unknown[] };
export type BundlerCheck = { ok: true; request: BundlerRequest } | { ok: false; status: 400 | 401 | 403 | 502; error: string };

/**
 * What /api/bundler forwards, rebuilt from scratch (spec, 6): only the flow's methods, only operations from
 * `account` (the logged-in member's Safe), only EntryPoint v0.7 on Celo, only operations that carry the attribution
 * tag (viem tags the callData before it asks for anything, so the estimate and the stub carry it too), and the
 * paymaster's context replaced by the server's sponsorship policy. Anything else never reaches Pimlico.
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
  if (!isTagged(userOp)) return { ok: false, status: 400, error: "The operation must end with TesorerIA's attribution tag" };
  if (method.startsWith("pm_")) {
    // ERC-7677: [userOp, entryPoint, chainId, context]. The policy is always the server's.
    if (params[2] !== CELO) return { ok: false, status: 400, error: "Celo only" };
    return { ok: true, request: { jsonrpc: "2.0", id, method, params: [userOp, entryPoint, CELO, { sponsorshipPolicyId }] } };
  }
  return { ok: true, request: { jsonrpc: "2.0", id, method, params: [userOp, entryPoint] } };
}

/** A call the operation makes from the member's Safe. */
export type OperationCall = { to: Address; value: bigint; data: Hex };

/** Safe4337Module: the Safe runs `to`, `value`, `data` with `operation` 0 (call) or 1 (delegatecall). */
const safe4337Abi = parseAbi([
  "function executeUserOp(address to, uint256 value, bytes data, uint8 operation)",
  "function executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)",
]);
const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);
/** Safe 1.4.1's MultiSendCallOnly, which permissionless delegates a batch to: it can only call, never delegatecall. */
const MULTI_SEND_CALL_ONLY: Address = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";

/**
 * `data` decoded with `abi`, but only if encoding what was decoded gives back exactly `data`: then what's checked is
 * what the contract runs, whatever bytes someone squeezed in or left out.
 */
function decodeExactly<const abi extends Abi>(abi: abi, data: Hex) {
  try {
    const decoded = decodeFunctionData({ abi, data });
    const again = encodeFunctionData({ abi, functionName: decoded.functionName, args: decoded.args } as Parameters<typeof encodeFunctionData>[0]);
    return again === data.toLowerCase() ? decoded : null;
  } catch {
    return null;
  }
}

/** MultiSend's packed list: per call, operation (1 byte), to (20), value (32), data length (32) and data. Only calls. */
function unpackMultiSend(transactions: Hex): OperationCall[] | null {
  const calls: OperationCall[] = [];
  const total = size(transactions);
  for (let at = 0; at < total; ) {
    if (total - at < 85) return null;
    if (hexToNumber(slice(transactions, at, at + 1)) !== 0) return null;
    const to = getAddress(slice(transactions, at + 1, at + 21));
    const value = hexToBigInt(slice(transactions, at + 21, at + 53));
    const length = hexToBigInt(slice(transactions, at + 53, at + 85));
    if (length > BigInt(total - at - 85)) return null;
    const data = length === 0n ? "0x" : slice(transactions, at + 85, at + 85 + Number(length));
    calls.push({ to, value, data });
    at += 85 + Number(length);
  }
  return calls.length > 0 ? calls : null;
}

/**
 * The calls a member's Safe makes for this callData, without the attribution suffix: Safe4337Module's
 * `executeUserOp` or `executeUserOpWithErrorString`, with one call, or with a batch delegated to MultiSendCallOnly.
 * Null for anything else, including an encoding other than the exact one those functions make.
 */
export function operationCalls(callData: string): OperationCall[] | null {
  if (!isHex(callData)) return null;
  const body = callData.toLowerCase().endsWith(SUFFIX) ? slice(callData, 0, size(callData) - size(ATTRIBUTION_SUFFIX)) : callData;
  const executed = decodeExactly(safe4337Abi, body);
  if (executed === null) return null;
  const [to, value, data, operation] = executed.args;
  if (operation === 0) return [{ to: getAddress(to), value, data }];
  if (operation !== 1 || !isAddressEqual(to, MULTI_SEND_CALL_ONLY) || value !== 0n) return null;
  const batch = decodeExactly(multiSendAbi, data);
  return batch === null ? null : unpackMultiSend(batch.args[0]);
}

/** Who may be sponsored, and for which funds. */
export type Sponsorship = {
  /** The live funds the person is a member of. */
  liveFunds: Address[];
  /**
   * The createFund calldata of each draft they created that is being created right now (`deploying`), exactly as
   * deployCall built it (`frozenCreateFunds`): the only createFunds theirs to send.
   */
  createFundCalls: Hex[];
};

/** What a live fund's member calls on it (spec, 9): contribute, and vote and execute. */
const FUND_CALLS = new Set(["contributeWars", "contributeUsdt", "vote", "execute"]);

/** Whether a member of the live funds `isLive` knows may make this call: approve one for wARS or USDT, or call it. */
function memberCall({ to, data }: OperationCall, isLive: (address: Address) => boolean): boolean {
  if (isAddressEqual(to, WARS) || isAddressEqual(to, USDT)) {
    const decoded = decodeExactly(erc20Abi, data);
    return decoded?.functionName === "approve" && isLive(decoded.args[0]);
  }
  if (!isLive(to)) return false;
  const decoded = decodeExactly(memberFundAbi, data);
  return decoded !== null && FUND_CALLS.has(decoded.functionName);
}

/**
 * The calls the paymaster pays for, and nothing else (spec, 6: no open sponsored bundler), all with no value:
 * - FundFactory.createFund, alone, from the creator of a fund being created, and only with the exact calldata
 *   deployCall built for that frozen draft (`createFundCalls`): its members in order, its votes, the server's agent;
 * - approve(fund, x) on wARS or USDT, and contributeWars, contributeUsdt, vote and execute on the fund, for a
 *   live fund the person is a member of.
 * `createsFund` says which: it gets the larger gas ceiling.
 */
export function checkCalls(
  calls: OperationCall[],
  { liveFunds, createFundCalls }: Sponsorship,
): { ok: true; createsFund: boolean } | { ok: false; status: 403; error: string } {
  const refuse = (error: string) => ({ ok: false, status: 403, error }) as const;
  if (calls.some((call) => call.value !== 0n)) return refuse("Sponsored calls can't send CELO");
  const [only] = calls;
  if (calls.length === 1 && only !== undefined && isAddressEqual(only.to, FUND_FACTORY)) {
    const data = only.data.toLowerCase();
    if (createFundCalls.some((frozen) => frozen.toLowerCase() === data)) return { ok: true, createsFund: true };
    return refuse("Only the createFund of a draft you are creating, exactly as it was frozen, is sponsored on the factory");
  }
  const isLive = (address: Address) => liveFunds.some((fund) => isAddressEqual(fund, address));
  const refused = calls.find((call) => !memberCall(call, isLive));
  if (refused !== undefined) return refuse(`Call not sponsored: ${refused.data.slice(0, 10)} on ${refused.to}`);
  return { ok: true, createsFund: false };
}

/** The operation's fee may be this many times Pimlico's current "fast" price: the client prices at "fast", the rest is room for the price to move before the paymaster signs. */
export const MAX_FEE_MULTIPLE = 2n;
/**
 * The creator's createFund: a first Safe deployment plus FundFactory.createFund used 3.85M gas on the fork (the
 * Fund's code deposit alone is ~2.95M). This leaves room for Pimlico's estimate and still caps what it can take.
 */
export const MAX_CREATE_FUND_GAS = 10_000_000n;
/**
 * Every other operation. The heaviest measured on the fork, a first contribution in USDT with the Safe's deployment,
 * used 642k gas (vote and execute with the deployment, 626k; once deployed, a contribution 230k and a vote 176k):
 * about three times that leaves room for Pimlico's estimate, and keeps what one operation can take small.
 */
export const MAX_OPERATION_GAS = 2_000_000n;
/**
 * The most createFund nonces the paymaster signs for one person, ever. A nonce lands at most once, so a creator gets
 * at most 3 createFunds sponsored: a legit one uses one per fund, and one more for each createFund that reverted
 * (retrying after a cancelled passkey prompt, or resending one that never came back, reuses the same nonce).
 */
export const MAX_CREATE_FUND_NONCES = 3;
/**
 * The most new createFund nonces the paymaster signs in a day, among everyone (M4). Passkey accounts are free to
 * make, so throwaway ones could each take MAX_CREATE_FUND_NONCES and use up the month's sponsorship, the real
 * groups' contributions and votes with it. A real group creates a fund or two a day. Two people claiming at once may
 * pass it by one: only each person's own row is locked.
 */
export const MAX_CREATE_FUND_NONCES_PER_DAY = 10;

const QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * What the paymaster signs when it sponsors (pm_getPaymasterData) is the operation with its fees and gas limits,
 * so those are bounded here: a member can't get a signature for an operation that overpays its bundler (itself,
 * if it submits the operation) out of the paymaster's deposit. `fastMaxFeePerGas` is Pimlico's current price, and
 * `maxGas` the most the limits may add up to.
 */
export function checkSponsoredGas(
  userOp: unknown,
  fastMaxFeePerGas: bigint,
  maxGas: bigint,
): { ok: true } | { ok: false; status: 400; error: string } {
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
  if ((gas as bigint[]).reduce((sum, limit) => sum + limit, 0n) > maxGas) return { ok: false, status: 400, error: "Gas limits too high" };
  return { ok: true };
}

/** The operation's EntryPoint nonce, if it's a hex quantity: its key in the upper 192 bits, its sequence in the lower 64. */
function operationNonce(userOp: unknown): bigint | undefined {
  const nonce = typeof userOp === "object" && userOp !== null ? (userOp as { nonce?: unknown }).nonce : undefined;
  return typeof nonce === "string" && QUANTITY.test(nonce) ? BigInt(nonce) : undefined;
}

/**
 * Whether the paymaster may sign `userId`'s createFund on `nonce`: it's one they already got signed (re-signing it
 * can't make it land twice), or a new one within MAX_CREATE_FUND_NONCES for them and MAX_CREATE_FUND_NONCES_PER_DAY
 * among everyone, which it then counts. The user's row is locked first, so two claims by one person never count the
 * same rows: the second waits for the first to commit, and then reads what it left. That relies on READ COMMITTED,
 * Neon's default (db/client.ts): under REPEATABLE READ, the count after the lock would miss the other claim (M1).
 */
export async function claimCreateFundNonce(db: Db, userId: string, nonce: bigint): Promise<boolean> {
  const [, , [claimed]] = await inTransaction(db, (tx) => {
    const signed = tx.$count(createFundNonces, eq(createFundNonces.userId, userId));
    const signedToday = tx.$count(createFundNonces, sql`${createFundNonces.createdAt} > now() - interval '1 day'`);
    return [
      tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update"),
      tx
        .insert(createFundNonces)
        .select((qb) =>
          qb
            .select({ userId: users.id, nonce: sql<bigint>`${nonce.toString()}::numeric`.as("nonce"), createdAt: sql<Date>`now()`.as("created_at") })
            .from(users)
            .where(
              and(
                eq(users.id, userId),
                sql`${signed} < ${MAX_CREATE_FUND_NONCES}`,
                sql`${signedToday} < ${MAX_CREATE_FUND_NONCES_PER_DAY}`,
              ),
            ),
        )
        .onConflictDoNothing(),
      tx
        .select({ nonce: createFundNonces.nonce })
        .from(createFundNonces)
        .where(and(eq(createFundNonces.userId, userId), eq(createFundNonces.nonce, nonce))),
    ];
  });
  return claimed !== undefined;
}

/**
 * The live funds `userId` is a member of, and the createFund of each draft they created that is being created,
 * naming `agent()`, which is called only if there's one.
 */
async function sponsorshipOf(db: Db, userId: string, agent: () => Address): Promise<Sponsorship> {
  const live = await db
    .select({ address: funds.address })
    .from(memberships)
    .innerJoin(funds, eq(funds.id, memberships.fundId))
    .where(and(eq(memberships.userId, userId), eq(funds.status, "live"), isNotNull(funds.address)));
  let createFundCalls: Sponsorship["createFundCalls"];
  try {
    createFundCalls = await frozenCreateFunds(db, userId, agent);
  } catch (error) {
    // A wrong agent key, say: no createFund is sponsored meanwhile, and a member's contributions and votes go on (M3).
    console.error(`No createFund is sponsored for now: ${shortMessage(error)}`);
    createFundCalls = [];
  }
  return { liveFunds: live.map((row) => getAddress(row.address!)), createFundCalls };
}

/**
 * `checkBundlerRequest`, and then who gets what:
 * - reading (the chain's id, a receipt, the price) is for anyone in a fund, draft or live;
 * - what carries the sponsorship (estimating, stubbing, signing or sending an operation) is only for a member of a
 *   live fund, or the creator of a draft being created (deployCall freezes it to `deploying` before the browser
 *   asks for anything), and only for the calls `checkCalls` allows: a stranger who makes an account and a draft
 *   gets nothing paid, and a creator only the createFund deployCall built for their frozen draft, naming `agent()`
 *   (the server's, `agentAddress`), and only on EntryPoint nonce key 0, the one the web sends it on. `agent` is
 *   called only for someone with a draft being created; when it throws (the server's agent key is wrong), their
 *   createFund is refused, and their contributions and votes, and anyone's reads, go on.
 *
 * `fastMaxFeePerGas` reads Pimlico's current price, only when it's needed: a sponsoring request (pm_getPaymasterData)
 * also has to pass `checkSponsoredGas`, with 10M gas for a createFund and 2M for anything else, and if the price can't
 * be read it's refused with 502 rather than signed blind. It's null only on the fork, which has no paymaster to protect.
 *
 * Last, a createFund is signed only on one of the creator's MAX_CREATE_FUND_NONCES nonces (`claimCreateFundNonce`),
 * on the fork too. A nonce lands at most once, so that's at most that many createFunds sponsored per creator, ever,
 * however long a draft stays `deploying` (it's live only once the creator's browser reports the receipt). Counted
 * only there: estimating, stubbing and sending sign nothing, and a request refused for its gas or price doesn't use
 * one up.
 */
export async function authorizeBundlerRequest(
  db: Db,
  user: { id: string; account: Address } | null,
  body: unknown,
  sponsorshipPolicyId: string,
  fastMaxFeePerGas: (() => Promise<bigint>) | null,
  agent: () => Address,
): Promise<BundlerCheck> {
  const check = checkBundlerRequest(body, user?.account ?? null, sponsorshipPolicyId);
  if (!check.ok || user === null) return check; // without a user the check never passes
  const { method, params } = check.request;
  if (!WITH_USER_OP.has(method)) {
    const [membership] = await db.select({ fundId: memberships.fundId }).from(memberships).where(eq(memberships.userId, user.id)).limit(1);
    return membership === undefined ? { ok: false, status: 403, error: "Only members of a fund use the bundler" } : check;
  }
  const sponsorship = await sponsorshipOf(db, user.id, agent);
  if (sponsorship.liveFunds.length === 0 && sponsorship.createFundCalls.length === 0) {
    return { ok: false, status: 403, error: "Only members of a live fund, and the creator of a fund being created, are sponsored" };
  }
  const calls = operationCalls((params[0] as { callData: string }).callData); // a string: checkBundlerRequest saw its tag
  if (calls === null) return { ok: false, status: 403, error: "Only a Safe's calls, one or a MultiSendCallOnly batch, are sponsored" };
  const allowed = checkCalls(calls, sponsorship);
  if (!allowed.ok) return allowed;
  // The web sends a createFund on nonce key 0 (client/wallet.ts), the only key whose nonces are counted below.
  const nonce = allowed.createsFund ? operationNonce(params[0]) : undefined;
  if (allowed.createsFund && nonce === undefined) return { ok: false, status: 400, error: "The nonce must be a hex quantity" };
  if (nonce !== undefined && nonce >> 64n !== 0n) return { ok: false, status: 403, error: "A createFund is sponsored only on EntryPoint nonce key 0" };

  if (method !== "pm_getPaymasterData") return check;
  if (fastMaxFeePerGas !== null) {
    let price: bigint;
    try {
      price = await fastMaxFeePerGas();
    } catch {
      return { ok: false, status: 502, error: "Couldn't read the current gas price" };
    }
    const gas = checkSponsoredGas(params[0], price, allowed.createsFund ? MAX_CREATE_FUND_GAS : MAX_OPERATION_GAS);
    if (!gas.ok) return gas;
  }
  if (nonce !== undefined && !(await claimCreateFundNonce(db, user.id, nonce))) {
    return {
      ok: false,
      status: 403,
      error: `No more createFunds are sponsored for this account (${MAX_CREATE_FUND_NONCES} at most, ever) or today (${MAX_CREATE_FUND_NONCES_PER_DAY} at most, among everyone)`,
    };
  }
  return check;
}

/**
 * Pimlico's answer, before it goes back to the browser. A paymaster stub that says it's final (ERC-7677 `isFinal`)
 * would make viem skip pm_getPaymasterData and send with the stub's data: a sponsorship signed without the gas and
 * fee checks above. Only the checked pm_getPaymasterData may sign, so such a stub is refused with 502.
 */
export function checkBundlerAnswer(method: string, text: string): { ok: true } | { ok: false; status: 502; error: string } {
  if (method !== "pm_getPaymasterStubData") return { ok: true };
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return { ok: true }; // not JSON: viem fails on it by itself
  }
  const result = typeof answer === "object" && answer !== null ? (answer as { result?: unknown }).result : undefined;
  const isFinal = typeof result === "object" && result !== null && (result as { isFinal?: unknown }).isFinal === true;
  return isFinal ? { ok: false, status: 502, error: "The paymaster's stub must not be final" } : { ok: true };
}
