import { describe, expect, it } from "vitest";
import { GET } from "../src/app/.well-known/webauthn/route";

describe("/.well-known/webauthn", () => {
  it("lists the origins that may use this site's passkeys, as JSON", async () => {
    const response = GET();
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ origins: ["https://prueba.tesoreria.finance"] });
  });
});
