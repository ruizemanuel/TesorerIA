import { describe, expect, it } from "vitest";
import { hashSchema, hexSchema } from "../src/lib/schemas";

describe("hexSchema", () => {
  it("takes 0x and hex digits, in any case", () => {
    for (const value of ["0x", "0x1", "0xAbCd09"]) expect(hexSchema.safeParse(value).success, value).toBe(true);
  });

  it("refuses everything else, so a malformed field never reaches the code that decodes it", () => {
    for (const value of ["abcd", "0xzz", "0x12 34", "0X12", " 0x12", "0x12\n", 12, null, undefined, {}]) {
      expect(hexSchema.safeParse(value).success, String(value)).toBe(false);
    }
  });
});

describe("hashSchema", () => {
  it("takes exactly 32 bytes", () => {
    expect(hashSchema.safeParse(`0x${"ab".repeat(32)}`).success).toBe(true);
    expect(hashSchema.safeParse(`0x${"ab".repeat(31)}`).success).toBe(false);
    expect(hashSchema.safeParse(`0x${"ab".repeat(33)}`).success).toBe(false);
    expect(hashSchema.safeParse(`0x${"zz".repeat(32)}`).success).toBe(false);
  });
});
