import { type Address, type Hash, type Hex, concat, encodeFunctionData, hexToBigInt, isHex, parseAbi, size, slice } from "viem";
import type { BundlerClient, SmartAccount } from "viem/account-abstraction";
import { readContract } from "viem/actions";
import { type CeloClient, SAFE_P256_VERIFIERS } from "./account";
import { ATTRIBUTION_SUFFIX } from "./attribution";
import { type SendTaggedCallsResult, waitForSentOperation } from "./send";

/**
 * Safe's `SafeWebAuthnSharedSigner` (verified on Blockscout): the owner of every member's Safe, which keeps the
 * passkey's public key in the Safe's own storage. `configure` runs only by delegatecall and has no other restriction,
 * so a Safe changes its key by delegatecalling it from one of its own operations.
 */
export const SAFE_WEBAUTHN_SHARED_SIGNER: Address = "0x94a4F6affBd8975951142c3999aEAB7ecee555c2";

/** A passkey's key as the shared signer stores it: the P-256 point and the verifiers that check its signatures. */
export type SafeKey = { x: bigint; y: bigint; verifiers: bigint };

const sharedSignerAbi = parseAbi([
  "function configure((uint256 x, uint256 y, uint176 verifiers) signer)",
  "function getConfiguration(address account) view returns ((uint256 x, uint256 y, uint176 verifiers) signer)",
]);
const safe4337Abi = parseAbi([
  "function executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)",
]);

/**
 * The shared signer's key for a passkey's public key: `0x` + x ‖ y (64 bytes, as `credentials.public_key` keeps it),
 * with the verifiers every member's Safe is set up with. Throws if the key is not 64 bytes, so a key with the
 * `04` prefix (65) never becomes a Safe's owner.
 */
export function safeKeyOf(publicKey: Hex): SafeKey {
  if (!isHex(publicKey, { strict: true }) || size(publicKey) !== 64) {
    throw new Error("A passkey's public key is 64 bytes: x and y, 32 bytes each, with no 04 prefix");
  }
  return {
    x: hexToBigInt(slice(publicKey, 0, 32)),
    y: hexToBigInt(slice(publicKey, 32, 64)),
    verifiers: BigInt(SAFE_P256_VERIFIERS),
  };
}

/** Whether `key`, as read from a Safe, is the one `publicKey` makes: same x, same y and same verifiers. */
export function isSafeKey(key: SafeKey, publicKey: Hex): boolean {
  const expected = safeKeyOf(publicKey);
  return key.x === expected.x && key.y === expected.y && key.verifiers === expected.verifiers;
}

/**
 * The callData of a UserOperation that changes the Safe's passkey to `publicKey`: Safe4337Module's
 * `executeUserOpWithErrorString` delegatecalling `configure` on the shared signer, then the attribution suffix, once.
 * The same encoding `createMemberAccount` gives any call, with operation 1 (delegatecall).
 */
export function keyChangeCallData(publicKey: Hex): Hex {
  const configure = encodeFunctionData({ abi: sharedSignerAbi, functionName: "configure", args: [safeKeyOf(publicKey)] });
  const execute = encodeFunctionData({
    abi: safe4337Abi,
    functionName: "executeUserOpWithErrorString",
    args: [SAFE_WEBAUTHN_SHARED_SIGNER, 0n, configure, 1],
  });
  return concat([execute, ATTRIBUTION_SUFFIX]);
}

/** The key the shared signer holds for `account`. A Safe that is not deployed yet, or never set up, reads as all zeros. */
export async function readSafeKey(client: CeloClient, account: Address): Promise<SafeKey> {
  const { x, y, verifiers } = await readContract(client, {
    address: SAFE_WEBAUTHN_SHARED_SIGNER,
    abi: sharedSignerAbi,
    functionName: "getConfiguration",
    args: [account],
  });
  return { x, y, verifiers };
}

/**
 * Sends the UserOperation that changes `account`'s passkey to `publicKey`, signed with the passkey it has now, and
 * waits like `sendTaggedCalls` (same `timeout` and `onSent`). If the Safe is not deployed, the operation deploys it
 * first, with its original key, and changes the key in the same go.
 */
export async function sendKeyChange({
  bundlerClient,
  account,
  publicKey,
  timeout,
  onSent,
}: {
  bundlerClient: BundlerClient;
  account: SmartAccount;
  publicKey: Hex;
  timeout?: number;
  onSent?: (userOpHash: Hash) => Promise<void> | void;
}): Promise<SendTaggedCallsResult> {
  const userOpHash = await bundlerClient.sendUserOperation({
    account,
    callData: keyChangeCallData(publicKey), // already ends with the suffix
    // viem adds a `dataSuffix` to the callData it is given (a tagged client has one by default), unless the client's
    // fee hook happens to hand the callData back as it came. An empty one leaves it as it is in every case: the
    // suffix once, which is all the bundler's gate reads.
    dataSuffix: "0x",
  });
  return waitForSentOperation({ bundlerClient, userOpHash, timeout, onSent });
}
