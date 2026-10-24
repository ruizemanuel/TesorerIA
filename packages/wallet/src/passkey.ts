import { Base64, Bytes, Cbor, Hash, Hex, P256, PublicKey, Signature, WebAuthnP256 } from "ox";

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

/** What a new passkey's registration leaves, as the authenticator reports it in the attestation. */
export type Attestation = {
  /** The new credential's id, base64url without padding, the form a login assertion's `credentialId` has. */
  credentialId: string;
  /** Uncompressed P-256 key as viem's createWebAuthnCredential returns it: 0x + x ‖ y, without the 04 prefix. */
  publicKey: Hex.Hex;
  /** sha256 of the RP ID the authenticator registered the passkey for. */
  rpIdHash: Hex.Hex;
  userVerified: boolean;
};

const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;
const FLAG_EXTENSIONS = 0x80;

// Authenticator data: rpIdHash (32) ‖ flags (1) ‖ signCount (4) ‖ aaguid (16) ‖ id length (2) ‖ id ‖ COSE key.
const FLAGS_OFFSET = 32;
const ID_LENGTH_OFFSET = 53;
const ID_OFFSET = 55;

/**
 * Reads the public key of a passkey that was just created, from the `attestationObject` its authenticator answered
 * with. The key comes from here and never from a field the browser fills in: a Safe has one owner and no recovery,
 * so a wrong key locks its funds for good. The attestation statement is not checked (`fmt` and `attStmt` can be
 * anything): the key is only trusted after its owner signs in with it. Throws if the data has no attested
 * credential, carries extensions, or holds a key that is not ES256 on P-256.
 */
export function readAttestation(attestationObject: Hex.Hex): Attestation {
  const authData = (decodeCbor(attestationObject, "attestation") as { authData?: unknown } | null)?.authData;
  if (!(authData instanceof Uint8Array)) throw new Error("The attestation has no authenticator data");
  if (authData.length < ID_OFFSET) throw new Error("The authenticator data is too short");

  const flags = authData[FLAGS_OFFSET] as number;
  if (!(flags & FLAG_ATTESTED_CREDENTIAL)) {
    throw new Error("The authenticator data has no attested credential (flag AT)");
  }
  if (flags & FLAG_EXTENSIONS) {
    throw new Error("The authenticator data has extension data (flag ED), which this site never asks for");
  }

  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const keyOffset = ID_OFFSET + view.getUint16(ID_LENGTH_OFFSET);
  if (authData.length < keyOffset) {
    throw new Error("The authenticator data is too short for the credential id it declares");
  }

  return {
    credentialId: Base64.fromBytes(authData.subarray(ID_OFFSET, keyOffset), { url: true, pad: false }),
    publicKey: readCoseKey(authData.subarray(keyOffset)),
    rpIdHash: Hex.fromBytes(authData.subarray(0, FLAGS_OFFSET)),
    userVerified: (flags & FLAG_USER_VERIFIED) !== 0,
  };
}

/** x ‖ y of an ES256 COSE key (map: 1 kty, 3 alg, -1 crv, -2 x, -3 y), read from the map whatever its key order. */
function readCoseKey(bytes: Uint8Array): Hex.Hex {
  const key = decodeCbor(bytes, "credential public key") as Record<string, unknown> | null;
  // ox's decoder stops after the first item and ignores what follows it, and extension data is refused, so nothing
  // may follow the key: if the bytes minus the last one still decode, that last byte is not part of the key.
  if (isCbor(bytes.subarray(0, -1))) throw new Error("The credential public key is followed by extra bytes");

  if (key?.["1"] !== 2 || key["3"] !== -7 || key["-1"] !== 1) {
    throw new Error("The passkey's key is not ES256 on P-256 (COSE kty 2, alg -7, crv 1)");
  }
  const x = key["-2"];
  const y = key["-3"];
  if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
    throw new Error("The passkey's key coordinates are not 32 bytes each");
  }
  return Hex.concat(Hex.fromBytes(x), Hex.fromBytes(y));
}

function decodeCbor(data: Hex.Hex | Uint8Array, what: string): unknown {
  try {
    return Cbor.decode(data);
  } catch (cause) {
    throw new Error(`The ${what} is not valid CBOR`, { cause });
  }
}

function isCbor(bytes: Uint8Array): boolean {
  try {
    Cbor.decode(bytes);
    return true;
  } catch {
    return false;
  }
}
