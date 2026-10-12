import { describe, expect, it } from "vitest";
import { countUpStart } from "../src/lib/count-up";

describe("countUpStart: the one moment plays once (spec, 9.2)", () => {
  const moment = { played: false, from: 1_000n, to: 9_000n, reducedMotion: false };

  it("counts up from the balance before your contribution", () => {
    expect(countUpStart(moment)).toBe(1_000n);
  });

  it("waits while the balance it's given is still the one before (a node behind), and plays when it moves", () => {
    expect(countUpStart({ ...moment, to: 1_000n })).toBeNull();
    expect(countUpStart(moment)).toBe(1_000n);
  });

  it("never plays again once it has: a later refresh (another member, the agent's conversion) just shows the balance", () => {
    expect(countUpStart({ ...moment, played: true, to: 9_500n })).toBeNull();
  });

  it("doesn't play with reduced motion", () => {
    expect(countUpStart({ ...moment, reducedMotion: true })).toBeNull();
  });
});
