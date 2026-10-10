import { createMemberAccount } from "@tesoreria/wallet";
import { toWebAuthnAccount } from "viem/account-abstraction";
import type { DeriveAccount } from "./auth";
import { celoClient } from "./chain";

/** The member's Safe, from their passkey: the same derivation the browser uses (golden-addresses.test.ts). */
export const deriveAccount: DeriveAccount = async ({ id, publicKey }) => {
  const owner = toWebAuthnAccount({ credential: { id, publicKey } });
  return (await createMemberAccount({ client: celoClient(), owner })).address;
};
