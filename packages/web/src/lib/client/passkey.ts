import { signPasskeyChallenge } from "@tesoreria/wallet";
import { type Hex, bytesToHex } from "viem";
import { createWebAuthnCredential } from "viem/account-abstraction";
import { LEGACY_RP_ID } from "../passkey-sites";
import { post } from "./api";
import { RefusedError } from "./errors";

/**
 * The site a passkey was made for (spec, 9.5): the current one, the server's RP ID, or the old one every passkey
 * made before tesoreria.finance still belongs to. A passkey signs for its own site whichever page it is used from.
 */
export type PasskeySite = "current" | "legacy";

const SITE_KEY = "tesoreria.passkey-site";

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

/**
 * The site whose passkeys the next login asks for. It follows what the server says is the person's active passkey
 * (`siteOf`, set by `loadMe` and by a key change), and the last login that worked. The current one if nothing is
 * saved or the storage fails.
 */
export function lastPasskeySite(): PasskeySite {
  try {
    return localStorage.getItem(SITE_KEY) === "legacy" ? "legacy" : "current";
  } catch {
    return "current"; // a private window, or blocked site data
  }
}

/** Keeps `site` for the next login. Not remembering is only a convenience lost, so a storage that fails is let be. */
export function rememberPasskeySite(site: PasskeySite): void {
  try {
    localStorage.setItem(SITE_KEY, site);
  } catch {
    // a private window, or blocked site data
  }
}

/** The site a passkey made for `rpId` belongs to. */
export function siteOf(rpId: string): PasskeySite {
  return rpId === LEGACY_RP_ID ? "legacy" : "current";
}

/**
 * Logs in with a passkey of `site`: the phone lets the person pick among that site's. The old site's passkeys sign
 * with its RP ID from this page too (related origins). The site is remembered once the login works.
 *
 * If the server doesn't know the old site's passkey the person signed with (401), it is a retired one: the key was
 * changed, maybe on another device that this browser never heard of. The memory goes back to the current site, so
 * the next tap asks for the new passkey, and the error is shown as it is: no second prompt comes by itself. A prompt
 * the person dismissed, or any other refusal, says nothing of which site is the right one.
 */
export async function logInWithPasskey(site: PasskeySite = lastPasskeySite()): Promise<void> {
  const { challenge, rpId } = await freshChallenge();
  const assertion = await signPasskeyChallenge({ challenge, rpId: site === "legacy" ? LEGACY_RP_ID : rpId });
  try {
    await post("/api/auth/login", assertion);
  } catch (error) {
    if (site === "legacy" && error instanceof RefusedError && error.status === 401) rememberPasskeySite("current");
    throw error;
  }
  rememberPasskeySite(site);
}
