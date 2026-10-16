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

  it("ignores invisible format characters: zero-width spaces and joiners, soft hyphens, the byte order mark", () => {
    const invisible = [0x200b, 0x200c, 0x200d, 0x2060, 0x00ad, 0xfeff].map((code) => String.fromCharCode(code));
    for (const mark of invisible) {
      const code = mark.charCodeAt(0).toString(16);
      expect(sameName(`Luc${mark}as`, "Lucas"), `inside, ${code}`).toBe(true);
      expect(sameName(`Lucas${mark}`, "Lucas"), `after, ${code}`).toBe(true);
      expect(sameName(`${mark}Lucas`, "lucás"), `before, ${code}`).toBe(true);
    }
    // They are no space: they neither split a word nor join two.
    expect(sameName(`Ana${invisible[0]}María`, "Anamaría")).toBe(true);
    expect(sameName(`Ana${invisible[0]} María`, "Ana María")).toBe(true);
    // A name made of nothing but invisible characters is blank.
    expect(sameName(invisible.join(""), invisible.join(""))).toBe(false);
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
