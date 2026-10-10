import { Base64, Bytes, Hash, Hex, P256, PublicKey, Signature, WebAuthnP256 } from "ox";

/** What the browser sends after signing the server's challenge with a passkey: the login ceremony. */
export type PasskeyAssertion = {
  /** The credential the person picked, base64url: the server looks its public key up by it. */
  credentialId: string;
  authenticatorData: Hex.Hex;
  clientDataJSON: string;
  /** r ‖ s, 64 bytes, with the low s (the same normalization ox applies). */
  signature: Hex.Hex;
};

type GetFn = NonNullable<WebAuthnP256.sign.Options["getFn"]>;

/**
 * Signs the server's `challenge` with a passkey (browser). Without `credentialId` the browser lets the person
 * pick any of this site's passkeys, which is how a second phone with a synced passkey logs in.
 */
export async function signPasskeyChallenge({
  challenge,
  credentialId,
  rpId,
  getFn,
}: {
  challenge: Hex.Hex;
  credentialId?: string;
  rpId?: string;
  getFn?: GetFn;
}): Promise<PasskeyAssertion> {
  const { metadata, raw } = await WebAuthnP256.sign({ challenge, credentialId, rpId, getFn });
  // Not ox's own `signature`: it reads the DER at fixed offsets, assuming r is 32 bytes, so the 1 in 256
  // signatures whose r starts with a zero byte come back wrong (ox 0.11.3). The DER is parsed properly here.
  const der = new Uint8Array((raw.response as unknown as { signature: ArrayBuffer }).signature);
  const { r, s } = P256.noble.Signature.fromDER(der).normalizeS();
  return {
    credentialId: raw.id,
    authenticatorData: metadata.authenticatorData,
    clientDataJSON: metadata.clientDataJSON,
    signature: Hex.concat(Hex.fromNumber(r, { size: 32 }), Hex.fromNumber(s, { size: 32 })),
  };
}

/**
 * Checks a login assertion on the server. ox's `verify` checks the flags, the challenge and the P-256
 * signature, but not where the ceremony ran: this also checks the origin, that it was a `get`, and that the
 * authenticator signed for `rpId`. User verification (fingerprint, face or PIN) is required.
 */
export function verifyPasskeyAssertion({
  assertion,
  publicKey,
  challenge,
  rpId,
  origin,
}: {
  assertion: PasskeyAssertion;
  /** Uncompressed P-256 key as viem's createWebAuthnCredential returns it: 0x + x ‖ y, without the 04 prefix. */
  publicKey: Hex.Hex;
  challenge: Hex.Hex;
  rpId: string;
  /** The page's full origin, port included: http://localhost:3000 in development. */
  origin: string;
}): boolean {
  let client: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    client = JSON.parse(assertion.clientDataJSON);
  } catch {
    return false;
  }
  if (client.type !== "webauthn.get" || client.origin !== origin || client.crossOrigin === true) return false;
  if (client.challenge !== Base64.fromHex(challenge, { url: true, pad: false })) return false;
  const authenticatorData = Bytes.fromHex(assertion.authenticatorData);
  if (authenticatorData.length < 37) return false;
  if (!Bytes.isEqual(authenticatorData.slice(0, 32), Hash.sha256(Bytes.fromString(rpId)))) return false;
  try {
    return WebAuthnP256.verify({
      challenge,
      publicKey: PublicKey.fromHex(Hex.size(publicKey) === 64 ? Hex.concat("0x04", publicKey) : publicKey),
      signature: Signature.fromHex(assertion.signature),
      metadata: {
        authenticatorData: assertion.authenticatorData,
        clientDataJSON: assertion.clientDataJSON,
        userVerificationRequired: true,
      },
    });
  } catch {
    return false; // a malformed key or signature
  }
}
