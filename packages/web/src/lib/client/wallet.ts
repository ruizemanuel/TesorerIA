import { type Call, type SendTaggedCallsResult, createMemberAccount, createPimlicoBundlerClient, sendTaggedCalls } from "@tesoreria/wallet";
import { type Address, type Hash, type Hex, createPublicClient, http } from "viem";
import {
  UserOperationNotFoundError,
  UserOperationReceiptNotFoundError,
  createBundlerClient,
  toWebAuthnAccount,
} from "viem/account-abstraction";
import { celo } from "viem/chains";
import { get, post } from "./api";
import { UserFacingError } from "./errors";

export type Me = { name: string; account: Address; credential: { id: string; publicKey: Hex } };
export type OperationInfo = {
  kind: "create-fund" | "contribute" | "vote";
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

const ON_ITS_WAY = "Tu operación está en camino. En unos minutos la vas a ver reflejada: no la mandes de nuevo.";

/**
 * Signs `calls` with the member's passkey and sends them as one sponsored UserOperation through /api/bundler.
 * The only function that knows a Safe with a passkey is behind it: the rest of the web just asks to sign calls
 * (spec, 12). The operation is recorded before its receipt, so it shows "en camino" and is never sent twice.
 *
 * `onSigned` is called as soon as the person has confirmed with the passkey, before the operation is sent.
 * Its own errors are `UserFacingError`s; viem's and the bundler's pass through for `userMessage` to map.
 */
export async function sendCalls(
  me: Me,
  calls: Call[],
  info: OperationInfo,
  onSigned?: () => void,
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
    throw new UserFacingError("Tu passkey no coincide con tu cuenta. Entrá de nuevo.");
  }
  const bundlerClient = createPimlicoBundlerClient({
    client,
    transport: bundlerTransport(),
    sponsorshipPolicyId: "set by the server", // /api/bundler replaces it
  });

  const record = (userOpHash: Hash) => post("/api/operations", { ...info, amount: info.amount?.toString(), userOpHash });
  let sent = undefined as Hash | undefined; // the hash as soon as the bundler took the operation, whatever happens next
  let result: SendTaggedCallsResult;
  try {
    result = await sendTaggedCalls({
      bundlerClient,
      account,
      calls,
      onSent: async (userOpHash) => {
        sent = userOpHash;
        await record(userOpHash);
      },
    });
  } catch (error) {
    if (sent === undefined) throw error; // it never left: the error says why
    // It is out, and either its receipt didn't come or it isn't recorded. Try to record it again and don't invite a retry.
    await record(sent).catch(() => {});
    throw new UserFacingError(ON_ITS_WAY, { cause: error });
  }
  if (result.unrecorded !== undefined) await record(result.userOpHash).catch(() => {});
  await post("/api/operations/done", {
    userOpHash: result.userOpHash,
    transactionHash: result.transactionHash,
    success: result.success,
  }).catch(() => {});
  if (!result.success) throw new UserFacingError("La operación no se pudo completar. No se movió plata.");
  return result;
}

/**
 * Settles an operation that went out earlier but whose receipt the server never got (the page closed, the wait
 * ran out): asks the bundler for it and records it. One the bundler no longer knows either is reported as
 * dropped, which the server takes only once it's old enough (`dropOperation`). Anything else throws "en
 * camino", so nothing is sent again in the meantime (spec, 6).
 */
export async function settleOperation(userOpHash: Hash): Promise<void> {
  const bundlerClient = createBundlerClient({ transport: bundlerTransport() });
  const receipt = await bundlerClient.getUserOperationReceipt({ hash: userOpHash }).catch((error: unknown) => {
    if (error instanceof UserOperationReceiptNotFoundError) return null;
    throw error;
  });
  if (receipt !== null) {
    await post("/api/operations/done", { userOpHash, transactionHash: receipt.receipt.transactionHash, success: receipt.success });
    return;
  }
  // Only a clear "not found" means dropped. An error, or a bundler without the method (the fork's), says nothing.
  const forgotten = await bundlerClient.getUserOperation({ hash: userOpHash }).then(
    () => false,
    (error: unknown) => error instanceof UserOperationNotFoundError,
  );
  if (forgotten && (await post<{ dropped: boolean }>("/api/operations/done", { userOpHash, dropped: true })).dropped) return;
  throw new UserFacingError(ON_ITS_WAY);
}
