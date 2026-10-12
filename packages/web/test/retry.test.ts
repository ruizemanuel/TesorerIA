import { describe, expect, it } from "vitest";
import { RETRY_DELAYS_MS, RETRY_WINDOW_MS, nextRetryDelay } from "../src/lib/retry";

describe("nextRetryDelay: the error page tries again by itself (spec, 9.2)", () => {
  const now = 10_000_000;

  it("waits a little, then longer, and then leaves it to the person", () => {
    expect(nextRetryDelay([], now)).toBe(RETRY_DELAYS_MS[0]);
    expect(nextRetryDelay([now - 5_000], now)).toBe(RETRY_DELAYS_MS[1]);
    expect(nextRetryDelay([now - 20_000, now - 10_000], now)).toBe(RETRY_DELAYS_MS[2]);
    expect(nextRetryDelay([now - 60_000, now - 40_000, now - 5_000], now)).toBeNull();
  });

  it("starts over once its earlier tries are old: a page that fails again much later", () => {
    expect(nextRetryDelay([now - RETRY_WINDOW_MS - 1, now - RETRY_WINDOW_MS, now - 1_000], now)).toBe(RETRY_DELAYS_MS[1]);
  });
});
