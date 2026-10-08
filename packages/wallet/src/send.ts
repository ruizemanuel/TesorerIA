import type { Address, Hash, Hex } from "viem";
import type { BundlerClient, SmartAccount } from "viem/account-abstraction";
import { ATTRIBUTION_SUFFIX } from "./attribution";

export type Call = { to: Address; data?: Hex; value?: bigint };

export type SendTaggedCallsResult = {
  userOpHash: Hash;
  transactionHash: Hash;
  success: boolean;
  /** The bundler's revert reason when `success` is false; undefined on success. */
  reason: string | undefined;
};

/**
 * Sends `calls` as one UserOperation and waits up to `timeout` ms for it to be included.
 * The suffix is also passed per call, so the operation is tagged even if
 * `bundlerClient` was not created with `createTaggedBundlerClient`.
 */
export async function sendTaggedCalls({
  bundlerClient,
  account,
  calls,
  timeout = 120_000,
}: {
  bundlerClient: BundlerClient;
  account: SmartAccount;
  calls: readonly Call[];
  timeout?: number;
}): Promise<SendTaggedCallsResult> {
  const userOpHash = await bundlerClient.sendUserOperation({
    account,
    calls,
    dataSuffix: ATTRIBUTION_SUFFIX,
  });
  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout });
  return {
    userOpHash,
    transactionHash: receipt.receipt.transactionHash,
    success: receipt.success,
    reason: receipt.success ? undefined : receipt.reason,
  };
}
