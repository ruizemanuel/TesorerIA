import { Base64, Bytes, Cbor, Hash, Hex } from "ox";
import { describe, expect, it } from "vitest";
import { safeKeyOf } from "../src/key-change";
import { readAttestation, signPasskeyChallenge, verifyPasskeyAssertion } from "../src/passkey";
import { type FakePasskey, createFakePasskey } from "./support/fakePasskey";

const RP_ID = "localhost";
const ORIGIN = "http://localhost";

/**
 * A `getFn` that asks the authenticator again until the DER signature it answers with has an `r` or `s` shorter
 * than 32 bytes, which happens to about 1 signature in 256 (the integer then starts with a zero byte). The
 * counter in the authenticator data changes on every ask, so each try signs something new.
 */
function withShortDer(passkey: FakePasskey, part: "r" | "s"): FakePasskey["getFn"] {
  return async (options) => {
    for (let attempt = 0; attempt < 5_000; attempt++) {
      const credential = await passkey.getFn(options);
      const der = new Uint8Array((credential as unknown as { response: { signature: ArrayBuffer } }).response.signature);
      const rLength = der[3] as number;
      if ((part === "r" ? rLength : (der[5 + rLength] as number)) < 32) return credential;
    }
    throw new Error(`no signature with a short ${part} in 5000 tries`);
  };
}

describe("passkey login", () => {
  const challenge = Hex.random(32);

  it("accepts an assertion signed by the member's passkey for this site", async () => {
    const passkey = createFakePasskey();
    const assertion = await signPasskeyChallenge({ challenge, rpId: RP_ID, getFn: passkey.getFn });
    // No credentialId asked for: the one the authenticator answered with comes back.
    expect(assertion.credentialId).toBe(passkey.credential.id);
    const ok = verifyPasskeyAssertion({ assertion, publicKey: passkey.credential.publicKey, challenge, rpId: RP_ID, origin: ORIGIN });
    expect(ok).toBe(true);
  });

  it.each(["r", "s"] as const)("accepts a login whose signature has a short %s, as 1 in 256 do", async (part) => {
    const passkey = createFakePasskey();
    const getFn = withShortDer(passkey, part);
    const assertion = await signPasskeyChallenge({ challenge, rpId: RP_ID, getFn });
    const ok = verifyPasskeyAssertion({ assertion, publicKey: passkey.credential.publicKey, challenge, rpId: RP_ID, origin: ORIGIN });
    expect(ok).toBe(true);
  });

  it("rejects another challenge, origin, site or key", async () => {
    const passkey = createFakePasskey();
    const assertion = await signPasskeyChallenge({ challenge, credentialId: passkey.credential.id, rpId: RP_ID, getFn: passkey.getFn });
    const base = { assertion, publicKey: passkey.credential.publicKey, challenge, rpId: RP_ID, origin: ORIGIN };
    expect(verifyPasskeyAssertion({ ...base, challenge: Hex.random(32) })).toBe(false);
    expect(verifyPasskeyAssertion({ ...base, origin: "http://localhost:3000" })).toBe(false);
    expect(verifyPasskeyAssertion({ ...base, rpId: "tesoreriaia.vercel.app" })).toBe(false);
    expect(verifyPasskeyAssertion({ ...base, publicKey: createFakePasskey().credential.publicKey })).toBe(false);
  });

  it("rejects a tampered or malformed assertion instead of throwing", async () => {
    const passkey = createFakePasskey();
    const assertion = await signPasskeyChallenge({ challenge, rpId: RP_ID, getFn: passkey.getFn });
    const base = { publicKey: passkey.credential.publicKey, challenge, rpId: RP_ID, origin: ORIGIN };
    const created = assertion.clientDataJSON.replace("webauthn.get", "webauthn.create");
    expect(verifyPasskeyAssertion({ ...base, assertion: { ...assertion, clientDataJSON: created } })).toBe(false);
    expect(verifyPasskeyAssertion({ ...base, assertion: { ...assertion, clientDataJSON: "not json" } })).toBe(false);
    expect(verifyPasskeyAssertion({ ...base, assertion: { ...assertion, signature: "0x1234" } })).toBe(false);
    expect(verifyPasskeyAssertion({ ...base, assertion, publicKey: "0x1234" })).toBe(false);
  });
});

describe("readAttestation", () => {
  const SITE = "tesoreria.finance";
  const challenge = Hex.random(32);

  // Where things sit in the fake's authenticator data: rpIdHash (32) || flags (1) || signCount (4) || aaguid (16) ||
  // id length (2) || id (16) || COSE key, which opens with the ten bytes a5 01 02 03 26 20 01 21 58 20 and then x.
  const FLAGS = 32;
  const COSE_KEY = 71;
  const COSE_KTY = COSE_KEY + 2; // 02: EC2
  const COSE_ALG = COSE_KEY + 4; // 26: -7, ES256
  const COSE_CRV = COSE_KEY + 6; // 01: P-256
  const COSE_X = COSE_KEY + 10;

  type AttestationObject = { fmt: string; attStmt: Record<string, unknown>; authData: Uint8Array };

  /** The same attestation with its authenticator data (and, if given, other top-level fields) replaced. */
  function rewrite(
    attestationObject: Hex.Hex,
    change: (authData: Uint8Array) => Uint8Array,
    fields: Partial<AttestationObject> = {},
  ): Hex.Hex {
    const decoded = Cbor.decode<AttestationObject>(attestationObject);
    return Cbor.encode({ ...decoded, ...fields, authData: change(decoded.authData) });
  }

  /** The authenticator data with one byte set to `value`. */
  const setByte = (index: number, value: number) => (authData: Uint8Array) => {
    const changed = authData.slice();
    changed[index] = value;
    return changed;
  };

  /** The authenticator data with its COSE key replaced by `key`. */
  const withKey = (key: Uint8Array) => (authData: Uint8Array) => Bytes.concat(authData.slice(0, COSE_KEY), key);

  // A COSE key written by hand, in the order and with the sizes given.
  const entry = (...bytes: number[]) => Uint8Array.of(...bytes);
  const coordinate = (label: number, value: Uint8Array) => Bytes.concat(entry(label, 0x58, value.length), value);
  const coseKey = (...parts: Uint8Array[]) => Bytes.concat(entry(0xa0 + parts.length), ...parts);
  const EC2 = entry(0x01, 0x02);
  const ES256 = entry(0x03, 0x26);
  const P256_CURVE = entry(0x20, 0x01);

  const split = (publicKey: Hex.Hex) => ({
    x: Bytes.fromHex(publicKey).slice(0, 32),
    y: Bytes.fromHex(publicKey).slice(32),
  });

  it("reads the credential id, the public key, the site and the user verification off the attestation", () => {
    const passkey = createFakePasskey({ rpId: SITE, origin: `https://${SITE}` });
    const { attestationObject } = passkey.attest({ challenge });
    expect(readAttestation(attestationObject)).toEqual({
      credentialId: passkey.credential.id,
      publicKey: passkey.credential.publicKey,
      rpIdHash: Hash.sha256(Bytes.fromString(SITE), { as: "Hex" }),
      userVerified: true,
    });
  });

  it("gives a creation ceremony's client data for the challenge, the site and the origin it is asked for", () => {
    const { clientDataJSON, attestationObject } = createFakePasskey().attest({
      challenge,
      rpId: SITE,
      origin: `https://${SITE}`,
    });
    expect(JSON.parse(clientDataJSON)).toEqual({
      type: "webauthn.create",
      challenge: Base64.fromHex(challenge, { url: true, pad: false }),
      origin: `https://${SITE}`,
      crossOrigin: false,
    });
    expect(readAttestation(attestationObject).rpIdHash).toBe(Hash.sha256(Bytes.fromString(SITE), { as: "Hex" }));
  });

  it("keeps 32 bytes for each coordinate, so a key whose x starts with zeros is still a key the Safe takes", () => {
    const passkey = createFakePasskey();
    const x = Bytes.concat(new Uint8Array(31), Uint8Array.of(1));
    const zeroPadded = rewrite(passkey.attest({ challenge }).attestationObject, (authData) => {
      const changed = authData.slice();
      changed.set(x, COSE_X);
      return changed;
    });
    const { publicKey } = readAttestation(zeroPadded);
    expect(publicKey).toBe(`0x${"00".repeat(31)}01${passkey.credential.publicKey.slice(2 + 64)}`);
    expect(() => safeKeyOf(publicKey)).not.toThrow();
  });

  it("reports an authenticator that did not verify the user", () => {
    const { attestationObject } = createFakePasskey().attest({ challenge });
    // 0x41: user present and attested credential, but not user verified.
    expect(readAttestation(rewrite(attestationObject, setByte(FLAGS, 0x41))).userVerified).toBe(false);
  });

  it("refuses an attestation without an attested credential, so there is no key to read", () => {
    const { attestationObject } = createFakePasskey().attest({ challenge });
    // 0x05 is UP | UV: the flags of a login, not of a registration.
    expect(() => readAttestation(rewrite(attestationObject, setByte(FLAGS, 0x05)))).toThrow(/attested credential/);
  });

  it("reads the key when extension data follows it, as when the browser asks for credProtect on its own", () => {
    const passkey = createFakePasskey({ rpId: SITE, origin: `https://${SITE}` });
    const { attestationObject } = passkey.attest({ challenge });
    // 0xc5 is UP | UV | AT | ED, and the extensions are a CBOR map after the key: credProtect's output, level 2.
    const extended = rewrite(attestationObject, (authData) =>
      Bytes.concat(setByte(FLAGS, 0xc5)(authData), Bytes.fromHex(Cbor.encode({ credProtect: 2 }))),
    );
    expect(readAttestation(extended)).toEqual({
      credentialId: passkey.credential.id,
      publicKey: passkey.credential.publicKey,
      rpIdHash: Hash.sha256(Bytes.fromString(SITE), { as: "Hex" }),
      userVerified: true,
    });
  });

  it("refuses a key that is not ES256 on P-256", () => {
    const { attestationObject } = createFakePasskey().attest({ challenge });
    expect(() => readAttestation(rewrite(attestationObject, setByte(COSE_ALG, 0x27)))).toThrow(/ES256/); // alg -8
    expect(() => readAttestation(rewrite(attestationObject, setByte(COSE_KTY, 0x01)))).toThrow(/ES256/); // OKP, not EC2
    expect(() => readAttestation(rewrite(attestationObject, setByte(COSE_CRV, 0x02)))).toThrow(/ES256/); // P-384
  });

  it("refuses a coordinate that is not 32 bytes", () => {
    const passkey = createFakePasskey();
    const { attestationObject } = passkey.attest({ challenge });
    const { x, y } = split(passkey.credential.publicKey);
    const short = coseKey(EC2, ES256, P256_CURVE, coordinate(0x21, x.slice(1)), coordinate(0x22, y));
    const long = coseKey(EC2, ES256, P256_CURVE, coordinate(0x21, x), coordinate(0x22, Bytes.concat(y, entry(0))));
    expect(() => readAttestation(rewrite(attestationObject, withKey(short)))).toThrow(/32 bytes/);
    expect(() => readAttestation(rewrite(attestationObject, withKey(long)))).toThrow(/32 bytes/);
  });

  it("takes the key from the map, whatever order the authenticator wrote it in", () => {
    const passkey = createFakePasskey();
    const { attestationObject } = passkey.attest({ challenge });
    const { x, y } = split(passkey.credential.publicKey);
    const reordered = coseKey(coordinate(0x22, y), P256_CURVE, coordinate(0x21, x), ES256, EC2);
    const changed = rewrite(attestationObject, withKey(reordered));
    expect(readAttestation(changed).publicKey).toBe(passkey.credential.publicKey);
  });

  it("accepts what real authenticators add: backup flags and a packed statement", () => {
    const passkey = createFakePasskey();
    const { attestationObject } = passkey.attest({ challenge });
    // 0x5d is UP | UV | BE | BS | AT: a passkey that syncs between a person's devices.
    const synced = rewrite(attestationObject, setByte(FLAGS, 0x5d), {
      fmt: "packed",
      attStmt: { alg: -7, sig: Bytes.random(70) },
    });
    expect(readAttestation(synced)).toMatchObject({
      credentialId: passkey.credential.id,
      publicKey: passkey.credential.publicKey,
      userVerified: true,
    });
  });

  it("refuses anything after the key when the flags declare no extension data", () => {
    const { attestationObject } = createFakePasskey().attest({ challenge });
    const trailing = rewrite(attestationObject, (authData) => Bytes.concat(authData, Uint8Array.of(0)));
    expect(() => readAttestation(trailing)).toThrow(/extra bytes/);
  });

  it("refuses authenticator data that ends before the key does", () => {
    const { attestationObject } = createFakePasskey().attest({ challenge });
    // Inside the header, inside the credential id, and inside the key.
    expect(() => readAttestation(rewrite(attestationObject, (authData) => authData.slice(0, 30)))).toThrow(/too short/);
    expect(() => readAttestation(rewrite(attestationObject, (authData) => authData.slice(0, 60)))).toThrow(/too short/);
    expect(() => readAttestation(rewrite(attestationObject, (authData) => authData.slice(0, COSE_X + 8)))).toThrow(/not valid CBOR/);
  });

  it("refuses an attestation that is not CBOR or has no authenticator data", () => {
    expect(() => readAttestation("0x")).toThrow(/not valid CBOR/);
    expect(() => readAttestation(Cbor.encode({ fmt: "none", attStmt: {} }))).toThrow(/no authenticator data/);
    expect(() => readAttestation(Cbor.encode(["none"]))).toThrow(/no authenticator data/);
  });
});
