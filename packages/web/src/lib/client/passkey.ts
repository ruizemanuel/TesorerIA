import { signPasskeyChallenge } from "@tesoreria/wallet";
import { type Hex, bytesToHex } from "viem";
import { createWebAuthnCredential } from "viem/account-abstraction";
import { post } from "./api";

/**
 * Creates the person's passkey and account. The user.id is random (spec, 6): one derived from the name would
 * let a second registration replace the passkey that controls the account.
 */
export async function createAccount({ name, email }: { name: string; email?: string }): Promise<void> {
  const { challenge } = await post<{ challenge: Hex }>("/api/auth/challenge");
  const userHandle = crypto.getRandomValues(new Uint8Array(16));
  const label = `TesorerIA (${name.trim()})`; // what the phone shows in its list of passkeys
  const credential = await createWebAuthnCredential({ challenge, name: label, user: { id: userHandle, name: label } });
  const response = credential.raw.response as AuthenticatorAttestationResponse;
  await post("/api/auth/register", {
    name,
    email,
    credentialId: credential.id,
    publicKey: credential.publicKey,
    userHandle: bytesToHex(userHandle),
    clientDataJSON: new TextDecoder().decode(response.clientDataJSON),
  });
}

/** Logs in with any of this site's passkeys: the phone lets the person pick. */
export async function logInWithPasskey(): Promise<void> {
  const { challenge } = await post<{ challenge: Hex }>("/api/auth/challenge");
  await post("/api/auth/login", await signPasskeyChallenge({ challenge }));
}
