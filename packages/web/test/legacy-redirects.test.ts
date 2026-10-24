import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS } from "../src/lib/legacy-redirects";

const OLD_HOST = [{ type: "host", value: "tesoreriaia.vercel.app" }];

describe("LEGACY_REDIRECTS", () => {
  // Which paths this rule catches is up to Next, which reads `source`: only a real `next start` proves it.
  it("is one permanent rule, only for the old host, for every path: nothing is left out of the redirect", () => {
    expect(LEGACY_REDIRECTS).toEqual([{ source: "/:path*", has: OLD_HOST, destination: "https://tesoreria.finance/:path*", permanent: true }]);
  });
});
