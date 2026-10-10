import { describe, expect, it } from "vitest";
import { safeNext } from "../src/lib/safe-next";

describe("safeNext", () => {
  it("keeps a path on this site, with its query and fragment", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/fondos/abc")).toBe("/fondos/abc");
    expect(safeNext("/unirse/abc?x=1#y")).toBe("/unirse/abc?x=1#y");
    expect(safeNext("/%2F%2Fevil")).toBe("/%2F%2Fevil"); // encoded slashes stay inside the path
  });

  it("falls back to the home page when there is nothing to go back to", () => {
    for (const value of [undefined, null, "", 5, ["/a", "/b"]]) expect(safeNext(value), String(value)).toBe("/");
  });

  it("never leaves the site, however the address is written", () => {
    const attacks = [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "\\\\evil.example",
      "https://evil.example",
      "https://evil.example/x",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "/.//evil.example",
      "/a/../..//evil.example",
      "http://[not-an-address",
    ];
    for (const attack of attacks) {
      const target = safeNext(attack);
      expect(target.startsWith("/") && !target.startsWith("//"), `${JSON.stringify(attack)} gave ${target}`).toBe(true);
      // Read the way a redirect reads it, it stays on this site.
      expect(new URL(target, "https://tesoreria.example").origin, JSON.stringify(attack)).toBe("https://tesoreria.example");
    }
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/\t/evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });
});
