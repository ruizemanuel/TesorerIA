import type { NextConfig } from "next";

type Redirect = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

/** The app's first address, where the passkeys made before tesoreria.finance belonged (spec, 9.5). */
const OLD_HOST = [{ type: "host" as const, value: "tesoreriaia.vercel.app" }];

/**
 * What the old address answers with a 308 to tesoreria.finance, for every path: the same path and query. Nothing is
 * left out: its passkeys no longer log in from the new address (there is no /.well-known/webauthn), and the heartbeat
 * calls tesoreria.finance, so the old address has nothing of its own to answer.
 * Next reads `source` (path-to-regexp), so what this rule catches is proved on a real `next start`, not in a test.
 */
export const LEGACY_REDIRECTS: Redirect[] = [
  { source: "/:path*", has: OLD_HOST, destination: "https://tesoreria.finance/:path*", permanent: true },
];
