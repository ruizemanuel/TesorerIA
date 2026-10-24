import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS } from "../src/lib/legacy-redirects";

const OLD_HOST = [{ type: "host", value: "tesoreriaia.vercel.app" }];

describe("LEGACY_REDIRECTS", () => {
  // Which paths these rules catch is up to Next, which reads `source`: only a real `next start` proves it.
  it("is exactly two permanent rules, both only for the old host: the root, and every path but two", () => {
    expect(LEGACY_REDIRECTS).toEqual([
      { source: "/", has: OLD_HOST, destination: "https://tesoreria.finance/", permanent: true },
      {
        source: "/:path((?!\\.well-known/webauthn$|api/agent/).+)",
        has: OLD_HOST,
        destination: "https://tesoreria.finance/:path",
        permanent: true,
      },
    ]);
  });
});
