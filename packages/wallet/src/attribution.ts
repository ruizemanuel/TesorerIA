import { type TxClient, toDataSuffix, verifyUserOps } from "@celo/attribution-tags";
import type { Address, Hash, Hex } from "viem";

/** TesorerIA's ERC-8021 attribution code on Celo. */
export const ATTRIBUTION_CODE = "celo_fbe4d00a2cb4";

/** Schema 0 suffix appended to the end of every UserOperation's callData. */
export const ATTRIBUTION_SUFFIX: Hex = toDataSuffix(ATTRIBUTION_CODE);

/**
 * Whether the bundle in transaction `hash` contains a UserOperation from `sender`
 * tagged with our code. `verifyTx` is not enough: in a shared bundle it returns only
 * the first tagged operation, which may belong to another project.
 *
 * Returns `true` or `false` when the transaction is a readable `handleOps` bundle, and
 * `null` when it is not a bundle or could not be read (RPC error, not indexed yet):
 * `null` means "unknown, try again", never "not attributed".
 */
export async function isUserOpAttributed({
  client,
  hash,
  sender,
}: {
  client: TxClient;
  hash: Hash;
  sender: Address;
}): Promise<boolean | null> {
  const userOps = await verifyUserOps({ client, hash });
  if (userOps === null) return null;
  return userOps.some(
    (userOp) =>
      userOp.sender.toLowerCase() === sender.toLowerCase() &&
      (userOp.attribution?.codes.includes(ATTRIBUTION_CODE) ?? false),
  );
}
