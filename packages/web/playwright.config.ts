import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 600_000,
  expect: { timeout: 90_000 },
  workers: 1,
  fullyParallel: false,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", locale: "es-AR" },
  // Phone first (spec, 9.1): a phone-sized Chromium, where CDP's virtual authenticator works. Playwright's browsers
  // speak en-US unless told otherwise: the friends' run stays in Spanish (spec, 9.3).
  projects: [{ name: "phone", use: { ...devices["Pixel 7"], locale: "es-AR" } }],
  webServer: { command: "node e2e/serve.ts", url: "http://localhost:3000", timeout: 300_000, reuseExistingServer: false },
});
