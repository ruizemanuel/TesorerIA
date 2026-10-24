import type { NextConfig } from "next";

type Redirect = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

/** The app's first address, where the passkeys made before tesoreria.finance still belong (spec, 9.5). */
const OLD_HOST = [{ type: "host" as const, value: "tesoreriaia.vercel.app" }];

/**
 * What the old address answers with a 308 to tesoreria.finance (the query goes along on its own). Two paths stay:
 * - /.well-known/webauthn: the browser reads Related Origin Requests from the passkeys' site and won't follow a
 *   redirect for it, so the old passkeys keep working on the new address;
 * - /api/agent/*: `fetch` drops the Authorization header across a cross-origin redirect, so a heartbeat still
 *   pointed at the old address would arrive unauthorized.
 * Next reads `source` (path-to-regexp), so what these rules catch is proved on a real `next start`, not in a test.
 */
export const LEGACY_REDIRECTS: Redirect[] = [
  { source: "/", has: OLD_HOST, destination: "https://tesoreria.finance/", permanent: true },
  {
    source: "/:path((?!\\.well-known/webauthn$|api/agent/).+)",
    has: OLD_HOST,
    destination: "https://tesoreria.finance/:path",
    permanent: true,
  },
];
