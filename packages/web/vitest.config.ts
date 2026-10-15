import { defineConfig } from "vitest/config";

export default defineConfig({
  // The dictionaries (src/lib/i18n) are .tsx: Next compiles JSX for the app, and this lets the tests import them.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 20_000 },
});
