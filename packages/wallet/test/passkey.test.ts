import { Hex } from "ox";
import { describe, expect, it } from "vitest";
import { signPasskeyChallenge, verifyPasskeyAssertion } from "../src/passkey";
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
