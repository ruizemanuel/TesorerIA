import { type Call, type SendTaggedCallsResult, createMemberAccount, createPimlicoBundlerClient, sendTaggedCalls } from "@tesoreria/wallet";
import { type Address, type Hash, type Hex, createPublicClient, http } from "viem";
import { UserOperationReceiptNotFoundError, createBundlerClient, toWebAuthnAccount } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { get, post } from "./api";
import { OnItsWayError, UserFacingError } from "./errors";

export type Me = { name: string; account: Address; credential: { id: string; publicKey: Hex } };
export type OperationInfo = {
  kind: "create-fund" | "contribute" | "vote" | "execute" | "cash-out";
  fund?: Address;
  amount?: bigint;
  token?: "wars" | "usdt";
  /** For `create-fund`: the draft it deploys, so a retried deploy finds the operation already sent. */
  draftId?: string;
};

/** Celo from the browser: forno, or anvil on the fork (NEXT_PUBLIC_CELO_RPC_URL). */
export function celoBrowserClient() {
  return createPublicClient({ chain: celo, transport: http(process.env.NEXT_PUBLIC_CELO_RPC_URL ?? "https://forno.celo.org") });
}

export function loadMe(): Promise<Me> {
  return get<Me>("/api/me");
}

/** Above the 30 s /api/bundler waits for Pimlico: if the browser gave up first, an operation Pimlico accepted would look unsent and invite a second one. */
const BUNDLER_TIMEOUT_MS = 45_000;

/** The bundler, through /api/bundler: the only door to it (spec, 6). */
function bundlerTransport() {
  return http(new URL("/api/bundler", window.location.origin).toString(), { timeout: BUNDLER_TIMEOUT_MS });
}

/**
 * Signs `calls` with the member's passkey and sends them as one sponsored UserOperation through /api/bundler.
 * The only function that knows a Safe with a passkey is behind it: the rest of the web just asks to sign calls
 * (spec, 12). The operation is recorded before its receipt, so it shows "en camino" and is never sent twice.
 *
 * `onSigned` is called as soon as the person has confirmed with the passkey, before the operation is sent.
 * `nonce` pins a createFund's EntryPoint nonce: the resend of one that never came back, so both can't land.
 * Its own errors are `UserFacingError`s, and an `OnItsWayError` when the operation is out and may still land;
 * viem's and the bundler's pass through for `userMessage` to map.
 */
export async function sendCalls(
  me: Me,
  calls: Call[],
  info: OperationInfo,
  onSigned?: () => void,
  nonce?: bigint,
): Promise<SendTaggedCallsResult> {
  const client = celoBrowserClient();
  const passkey = toWebAuthnAccount({ credential: me.credential });
  // The Safe signs by asking its owner to `sign`: when that returns, the person has confirmed.
  const owner: typeof passkey = {
    ...passkey,
    async sign(parameters) {
      const signed = await passkey.sign(parameters);
      onSigned?.();
      return signed;
    },
  };
  const account = await createMemberAccount({ client, owner });
  if (account.address.toLowerCase() !== me.account.toLowerCase()) {
    throw new UserFacingError({ key: "wrongPasskey" });
  }
  const bundlerClient = createPimlicoBundlerClient({
    client,
    transport: bundlerTransport(),
    sponsorshipPolicyId: "set by the server", // /api/bundler replaces it
  });

  // A createFund goes on nonce key 0, read here so the record keeps it: the server releases one that never came
  // back only while the chain still has that nonce, and pins its resend to it (funds.ts). Anything else lets viem
  // pick a fresh key per operation, as before, so a contribution and a vote can be out at the same time.
  const useNonce = info.kind === "create-fund" ? (nonce ?? (await nonceOf(account))) : nonce;
  const record = (userOpHash: Hash) =>
    post("/api/operations", { ...info, amount: info.amount?.toString(), nonce: useNonce?.toString(), userOpHash });
  let sent = undefined as Hash | undefined; // the hash as soon as the bundler took the operation, whatever happens next
  let result: SendTaggedCallsResult;
  try {
    result = await sendTaggedCalls({
      bundlerClient,
      account,
      calls,
      nonce: useNonce,
      onSent: async (userOpHash) => {
        sent = userOpHash;
        await record(userOpHash);
      },
    });
  } catch (error) {
    if (sent === undefined) throw error; // it never left: the error says why
    // It is out, and either its receipt didn't come or it isn't recorded. Try to record it again and don't invite a retry.
    await record(sent).catch(() => {});
    throw new OnItsWayError({ cause: error });
  }
  if (result.unrecorded !== undefined) await record(result.userOpHash).catch(() => {});
  // The operation has landed: a receipt without a block (viem reads null, whatever its type says) must not fail it.
  await post("/api/operations/done", {
    userOpHash: result.userOpHash,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber?.toString(),
    success: result.success,
  }).catch(() => {});
  if (!result.success) throw new UserFacingError({ key: "notCompleted" });
  return result;
}

/** The account's EntryPoint nonce now, with key 0: the one its next operation takes. */
async function nonceOf(account: Awaited<ReturnType<typeof createMemberAccount>>): Promise<bigint> {
  if (account.getNonce === undefined) throw new Error("The account can't tell its nonce");
  return account.getNonce({ key: 0n });
}

/**
 * Settles an operation that went out earlier but whose receipt the server never got (the page closed, the wait
 * ran out): asks the bundler for it and records it. While it isn't included it throws "en camino", so nothing
 * is sent again in the meantime (spec, 6).
 */
export async function settleOperation(userOpHash: Hash): Promise<void> {
  const bundlerClient = createBundlerClient({ transport: bundlerTransport() });
  let receipt: Awaited<ReturnType<typeof bundlerClient.getUserOperationReceipt>>;
  try {
    receipt = await bundlerClient.getUserOperationReceipt({ hash: userOpHash });
  } catch (error) {
    if (error instanceof UserOperationReceiptNotFoundError) throw new OnItsWayError({ cause: error });
    throw error;
  }
  await post("/api/operations/done", {
    userOpHash,
    transactionHash: receipt.receipt.transactionHash,
    blockNumber: receipt.receipt.blockNumber?.toString(), // null if the receipt has none: the server takes it without
    success: receipt.success,
  });
}
