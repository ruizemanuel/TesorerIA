import { describe, expect, it } from "vitest";
import { sameName } from "../src/lib/same-name";

const NBSP = String.fromCharCode(0xa0);
/** A combining acute accent, which goes after the letter it marks. */
const ACUTE = String.fromCharCode(0x301);

describe("sameName", () => {
  it("matches the same name however it's written: case, accents and spaces", () => {
    expect(sameName("Lucas", "Lucas")).toBe(true);
    expect(sameName("Lucas", "lucas")).toBe(true);
    expect(sameName("LUCAS", "Lucás")).toBe(true);
    expect(sameName("Lucas", " Lucas ")).toBe(true);
    expect(sameName("ana  maría", "Ana María")).toBe(true);
    expect(sameName("Nuñez", "Nunez")).toBe(true);
  });

  it("counts any run of white space as one space", () => {
    expect(sameName("Ana\t  María", "Ana María")).toBe(true);
    expect(sameName("Ana\nMaría", "Ana María")).toBe(true);
    expect(sameName(`Ana${NBSP}María`, "Ana María")).toBe(true);
  });

  it("matches an accent written as a separate mark, and full-width letters", () => {
    expect(sameName(`Lucas${ACUTE}`, "Lucas")).toBe(true);
    expect(sameName("Ｌｕｃａｓ", "lucas")).toBe(true);
  });

  it("tells different names apart, even close ones", () => {
    expect(sameName("Lucas", "Lucía")).toBe(false);
    expect(sameName("Juan", "Juana")).toBe(false);
    expect(sameName("Ana María", "Anamaría")).toBe(false);
    expect(sameName("Lucas", "Lucas R")).toBe(false);
  });

  it("never matches an empty or blank name, not even with another one", () => {
    expect(sameName("", "")).toBe(false);
    expect(sameName("  ", "\t")).toBe(false);
    expect(sameName("", "Lucas")).toBe(false);
    expect(sameName("Lucas", "   ")).toBe(false);
  });
});
