import { signPasskeyChallenge } from "@tesoreria/wallet";
import { type Hex, bytesToHex } from "viem";
import { createWebAuthnCredential } from "viem/account-abstraction";
import { post } from "./api";

type Challenge = { challenge: Hex; rpId: string };

/** A fresh challenge, and the RP ID the server makes passkeys for. */
export function freshChallenge(): Promise<Challenge> {
  return post<Challenge>("/api/auth/challenge");
}

/**
 * Makes a passkey for the server's site, on a fresh challenge, and answers what /api/auth/register and
 * /api/auth/key take. The user.id is random (spec, 6): one derived from the name would let a second registration
 * replace the passkey that controls the account. The key itself is not sent: the server reads it from the
 * attestation, which stays "none" (the default), so the phone isn't asked to identify itself.
 */
export async function createPasskey(name: string) {
  const { challenge, rpId } = await freshChallenge();
  const userHandle = crypto.getRandomValues(new Uint8Array(16));
  const label = `TesorerIA (${name.trim()})`; // what the phone shows in its list of passkeys
  const credential = await createWebAuthnCredential({
    challenge,
    rp: { id: rpId, name: "TesorerIA" },
    name: label,
    user: { id: userHandle, name: label },
  });
  const response = credential.raw.response as AuthenticatorAttestationResponse;
  return {
    credentialId: credential.id,
    attestationObject: bytesToHex(new Uint8Array(response.attestationObject)),
    userHandle: bytesToHex(userHandle),
    clientDataJSON: new TextDecoder().decode(response.clientDataJSON),
  };
}

/** Creates the person's passkey and account. */
export async function createAccount({ name, email }: { name: string; email?: string }): Promise<void> {
  await post("/api/auth/register", { name, email, ...(await createPasskey(name)) });
}

/** Logs in with a passkey of the site the challenge names (the server's RP ID): the phone lets the person pick among its passkeys. */
export async function logInWithPasskey(): Promise<void> {
  const { challenge, rpId } = await freshChallenge();
  const assertion = await signPasskeyChallenge({ challenge, rpId });
  await post("/api/auth/login", assertion);
}
