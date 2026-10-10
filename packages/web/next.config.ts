import type { NextConfig } from "next";

const config: NextConfig = {
  // The workspace packages export TypeScript source (spec, 6).
  transpilePackages: ["@tesoreria/wallet", "@tesoreria/agent"],
  // PGlite loads its wasm and data files relative to its own module, so Next must not bundle it.
  serverExternalPackages: ["@electric-sql/pglite"],
  // `next dev` would otherwise write an AGENTS.md into the package on every start.
  agentRules: false,
};

export default config;
