import { toKernelSmartAccount, toSafeSmartAccount } from "permissionless/accounts";
import type { Address, Chain, Client, JsonRpcAccount, LocalAccount, Transport } from "viem";
import { type SmartAccount, type WebAuthnAccount, entryPoint07Address } from "viem/account-abstraction";

export type AccountKind = "safe" | "kernel";

/**
 * A viem client with a `chain` (viem reads it for the nonce key), e.g. a public client
 * for Celo. The account type matches what permissionless accepts.
 */
export type CeloClient = Client<Transport, Chain, JsonRpcAccount | LocalAccount | undefined>;

/**
 * Safe `P256.Verifiers` (uint176) for the passkey signer: the P-256 precompile at 0x100
 * in the top 16 bits, Safe's FCLP256Verifier (0xA86e…5DBA) as fallback in the low 160 bits.
 * Part of the Safe init code, so changing it changes every member's address.
 */
export const SAFE_P256_VERIFIERS = "0x0100A86e0054C51E4894D88762a017ECc5E5235f5DBA" as Address;

const entryPoint = { address: entryPoint07Address, version: "0.7" } as const;

/** A member's ERC-4337 smart account (EntryPoint v0.7) owned by a passkey. */
export function createMemberAccount({
  client,
  owner,
  kind = "safe",
}: {
  client: CeloClient;
  owner: WebAuthnAccount;
  kind?: AccountKind;
}): Promise<SmartAccount> {
  if (kind === "kernel") {
    // Kernel 0.3.1 with the patched WebAuthn validator; verifies through Daimo's P256Verifier.
    return toKernelSmartAccount({ client, owners: [owner], version: "0.3.1", entryPoint });
  }
  return toSafeSmartAccount({
    client,
    owners: [owner],
    version: "1.4.1",
    entryPoint,
    safeP256VerifierAddress: SAFE_P256_VERIFIERS,
  });
}
