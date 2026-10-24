/**
 * WebAuthn's Related Origin Requests: the other origins that may use the passkeys made for this site, whose RP ID
 * stays tesoreriaia.vercel.app. Browsers fetch this file from the RP ID's origin, so it must not redirect.
 * For now, only the passkey probe.
 */
export function GET() {
  return Response.json({ origins: ["https://prueba.tesoreria.finance"] });
}
