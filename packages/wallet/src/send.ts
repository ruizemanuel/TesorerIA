import { BaseError, type Address, type Hash, type Hex } from "viem";
import type { BundlerClient, SmartAccount } from "viem/account-abstraction";
import { ATTRIBUTION_SUFFIX } from "./attribution";

export type Call = { to: Address; data?: Hex; value?: bigint };

export type SendTaggedCallsResult = {
  userOpHash: Hash;
  transactionHash: Hash;
  success: boolean;
  /** The bundler's revert reason when `success` is false; undefined on success. */
  reason: string | undefined;
  /** Why `onSent` failed, when it did: the caller has no record of `userOpHash`, so it must keep it itself. */
  unrecorded?: string;
};

/**
 * Sends `calls` as one UserOperation and waits up to `timeout` ms for it to be included.
 * The suffix is also passed per call, so the operation is tagged even if
 * `bundlerClient` was not created with `createTaggedBundlerClient`.
 *
 * `onSent` gets the UserOperation's hash before the wait, so the caller can keep it and never send the same
 * thing twice after a timeout. If it throws, the wait goes on: the operation is already out. The failure is
 * reported in the result's `unrecorded`, or, if the wait then fails too, in the error thrown, which names the hash.
 */
export async function sendTaggedCalls({
  bundlerClient,
  account,
  calls,
  timeout = 120_000,
  onSent,
}: {
  bundlerClient: BundlerClient;
  account: SmartAccount;
  calls: readonly Call[];
  timeout?: number;
  onSent?: (userOpHash: Hash) => Promise<void> | void;
}): Promise<SendTaggedCallsResult> {
  const userOpHash = await bundlerClient.sendUserOperation({
    account,
    calls,
    dataSuffix: ATTRIBUTION_SUFFIX,
  });
  let unrecorded: string | undefined;
  try {
    await onSent?.(userOpHash);
  } catch (error) {
    unrecorded = shortMessage(error); // the operation is out either way
  }
  let receipt;
  try {
    receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout });
  } catch (error) {
    if (unrecorded === undefined) throw error;
    // Out, with no receipt and no record of its hash: the message is all that is left of it.
    throw new Error(
      `UserOperation ${userOpHash} was sent but its receipt is unknown (${shortMessage(error)}); its hash was not recorded: ${unrecorded}`,
      { cause: error },
    );
  }
  const result: SendTaggedCallsResult = {
    userOpHash,
    transactionHash: receipt.receipt.transactionHash,
    success: receipt.success,
    reason: receipt.success ? undefined : receipt.reason,
  };
  if (unrecorded !== undefined) result.unrecorded = unrecorded;
  return result;
}

function shortMessage(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}
