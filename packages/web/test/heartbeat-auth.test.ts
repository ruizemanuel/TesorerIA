import { describe, expect, it } from "vitest";
import { isHeartbeatAuthorized } from "../src/lib/heartbeat-auth";

const SECRET = "s".repeat(64);

describe("isHeartbeatAuthorized", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isHeartbeatAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    for (const header of [null, "", SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, `bearer ${SECRET}`, "Bearer "]) {
      expect(isHeartbeatAuthorized(header, SECRET), String(header)).toBe(false);
    }
  });

  it("accepts nothing when no secret is set", () => {
    expect(isHeartbeatAuthorized("Bearer ", undefined)).toBe(false);
    expect(isHeartbeatAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});
