import { Base64, Bytes, Cbor, Hash, P256, PublicKey } from "ox";
import type { Hex } from "viem";
import type { ToWebAuthnAccountParameters } from "viem/account-abstraction";

type GetFn = NonNullable<ToWebAuthnAccountParameters["getFn"]>;
type RequestOptions = Parameters<GetFn>[0];

export type FakePasskey = {
  credential: { id: string; publicKey: Hex };
  getFn: GetFn;
  /** Stands in for `navigator.credentials.create`: the two parts of a registration the server reads. */
  attest: (options: { challenge: Hex; rpId?: string; origin?: string }) => {
    attestationObject: Hex;
    clientDataJSON: string;
  };
};

/**
 * In-memory P-256 authenticator for tests. `getFn` stands in for
 * `navigator.credentials.get` and returns a real-format WebAuthn assertion:
 * authenticatorData = sha256(rpId) || flags (UP|UV) || signCount,
 * clientDataJSON = {"type":"webauthn.get","challenge":<b64url>,"origin":...,"crossOrigin":false},
 * signature = DER(low-s ECDSA P-256 over sha256(authenticatorData || sha256(clientDataJSON))).
 *
 * `attest` stands in for registration (`navigator.credentials.create`): the attestationObject is CBOR with
 * fmt "none" and authData = sha256(rpId) || flags (UP|UV|AT) || signCount 0 || 16 zero bytes (aaguid) ||
 * id length || id || the COSE key, written byte by byte as an authenticator does, and the clientDataJSON is a
 * "webauthn.create" one. `rpId` and `origin` default to the ones the passkey was made for.
 */
export function createFakePasskey({
  rpId = "localhost",
  origin = "http://localhost",
}: { rpId?: string; origin?: string } = {}): FakePasskey {
  const privateKey = P256.randomPrivateKey();
  const publicKey = PublicKey.toHex(P256.getPublicKey({ privateKey }), {
    includePrefix: false,
  });
  const rawId = Bytes.random(16);
  const id = Base64.fromBytes(rawId, { url: true, pad: false });
  let signCount = 0;

  const getFn: GetFn = async (options?: RequestOptions) => {
    const request = options?.publicKey;
    if (!request) throw new Error("fakePasskey: publicKey request options missing");
    if (request.rpId !== undefined && request.rpId !== rpId)
      throw new Error(`fakePasskey: rpId mismatch (${request.rpId} != ${rpId})`);
    const allowed = request.allowCredentials ?? [];
    if (allowed.length > 0 && !allowed.some((c) => Bytes.isEqual(toBytes(c.id), rawId)))
      throw new Error("fakePasskey: credential not allowed");

    signCount += 1;
    const authenticatorData = Bytes.concat(
      Hash.sha256(Bytes.fromString(rpId)),
      Uint8Array.of(0x05), // UP | UV
      Bytes.fromNumber(signCount, { size: 4 }),
    );
    const clientDataJSON = Bytes.fromString(
      JSON.stringify({
        type: "webauthn.get",
        challenge: Base64.fromBytes(toBytes(request.challenge), { url: true, pad: false }),
        origin,
        crossOrigin: false,
      }),
    );
    const { r, s } = P256.sign({
      payload: Bytes.concat(authenticatorData, Hash.sha256(clientDataJSON)),
      privateKey,
      hash: true, // ECDSA over sha256(payload); ox signs with lowS: true
    });

    return {
      id,
      type: "public-key",
      rawId: toArrayBuffer(rawId),
      authenticatorAttachment: "platform",
      response: {
        authenticatorData: toArrayBuffer(authenticatorData),
        clientDataJSON: toArrayBuffer(clientDataJSON),
        signature: toArrayBuffer(toDerSignature(r, s)),
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    };
  };

  const attest: FakePasskey["attest"] = ({ challenge, rpId: attestedRpId = rpId, origin: attestedOrigin = origin }) => {
    const key = Bytes.fromHex(publicKey);
    const authData = Bytes.concat(
      Hash.sha256(Bytes.fromString(attestedRpId)),
      Uint8Array.of(0x45), // UP | UV | AT
      new Uint8Array(4), // signCount
      new Uint8Array(16), // aaguid
      Bytes.fromNumber(rawId.length, { size: 2 }),
      rawId,
      // COSE_Key { 1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y }
      Uint8Array.of(0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20),
      key.slice(0, 32),
      Uint8Array.of(0x22, 0x58, 0x20),
      key.slice(32),
    );
    const clientDataJSON = JSON.stringify({
      type: "webauthn.create",
      challenge: Base64.fromHex(challenge, { url: true, pad: false }),
      origin: attestedOrigin,
      crossOrigin: false,
    });
    return { attestationObject: Cbor.encode({ fmt: "none", attStmt: {}, authData }), clientDataJSON };
  };

  return { credential: { id, publicKey }, getFn, attest };
}

function toBytes(source: ArrayBuffer | ArrayBufferView): Uint8Array {
  return source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/** ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s } with minimal, positive integers. */
function toDerSignature(r: bigint, s: bigint): Uint8Array {
  const integer = (value: bigint) => {
    let bytes = Bytes.fromHex(`0x${value.toString(16).padStart(64, "0")}`);
    while (bytes.length > 1 && bytes[0] === 0 && bytes[1]! < 0x80) bytes = bytes.slice(1);
    if (bytes[0]! >= 0x80) bytes = Bytes.concat(Uint8Array.of(0), bytes);
    return Bytes.concat(Uint8Array.of(0x02, bytes.length), bytes);
  };
  const body = Bytes.concat(integer(r), integer(s));
  return Bytes.concat(Uint8Array.of(0x30, body.length), body);
}
