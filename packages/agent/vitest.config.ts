import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "test/fork/**"],
        },
      },
      {
        test: {
          name: "fork",
          include: ["test/fork/**/*.test.ts"],
          globalSetup: ["./test/support/anvil.globalSetup.ts"],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
