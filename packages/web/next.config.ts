import type { NextConfig } from "next";
import { LEGACY_REDIRECTS } from "./src/lib/legacy-redirects";

const config: NextConfig = {
  // The workspace packages export TypeScript source (spec, 6).
  transpilePackages: ["@tesoreria/wallet", "@tesoreria/agent"],
  // PGlite loads its wasm and data files relative to its own module, so Next must not bundle it.
  serverExternalPackages: ["@electric-sql/pglite"],
  // `next dev` would otherwise write an AGENTS.md into the package on every start.
  agentRules: false,
  // The old address moves to tesoreria.finance (spec, 9.5).
  redirects: async () => LEGACY_REDIRECTS,
};

export default config;
