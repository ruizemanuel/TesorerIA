import { defineConfig } from "vitest/config";

export default defineConfig({
  // The dictionaries (src/lib/i18n) are .tsx: Next compiles JSX for the app, and this lets the tests import them.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Above the defaults (a 10 s hook, a 5 s test) for a slow or shared machine, as CI's runners or a sandbox can be:
    // the first database a file opens runs PGlite's initdb (test/support/db.ts), often in a beforeEach, and on a
    // busy machine that alone can pass 10 s.
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
