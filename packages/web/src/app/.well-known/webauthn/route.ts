/**
 * WebAuthn's Related Origin Requests: the other origins that may use the passkeys made for this site, whose RP ID
 * stays tesoreriaia.vercel.app. Browsers fetch this file from the RP ID's origin, so it must not redirect
 * (next.config.ts leaves it out of the old address's redirect). It lists the new address, and the passkey probe.
 */
export function GET() {
  return Response.json({ origins: ["https://tesoreria.finance", "https://prueba.tesoreria.finance"] });
}
