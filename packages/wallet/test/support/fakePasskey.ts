import { Base64, Bytes, Hash, P256, PublicKey } from "ox";
import type { Hex } from "viem";
import type { ToWebAuthnAccountParameters } from "viem/account-abstraction";

type GetFn = NonNullable<ToWebAuthnAccountParameters["getFn"]>;
type RequestOptions = Parameters<GetFn>[0];

export type FakePasskey = {
  credential: { id: string; publicKey: Hex };
  getFn: GetFn;
};

/**
 * In-memory P-256 authenticator for tests. `getFn` stands in for
 * `navigator.credentials.get` and returns a real-format WebAuthn assertion:
 * authenticatorData = sha256(rpId) || flags (UP|UV) || signCount,
 * clientDataJSON = {"type":"webauthn.get","challenge":<b64url>,"origin":...,"crossOrigin":false},
 * signature = DER(low-s ECDSA P-256 over sha256(authenticatorData || sha256(clientDataJSON))).
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

  return { credential: { id, publicKey }, getFn };
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
