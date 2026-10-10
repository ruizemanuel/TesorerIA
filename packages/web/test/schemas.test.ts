import { describe, expect, it } from "vitest";
import { addressSchema, hashSchema, hexSchema } from "../src/lib/schemas";

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

describe("addressSchema", () => {
  const checksummed = "0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F";

  it("takes 20 bytes in any case and gives them back checksummed", () => {
    expect(addressSchema.parse(checksummed.toLowerCase())).toBe(checksummed);
    expect(addressSchema.parse(checksummed)).toBe(checksummed);
  });

  it("refuses anything that is not an address, so a fund is looked up by one form only", () => {
    for (const value of ["0x", checksummed.slice(0, -2), `${checksummed}00`, `0x${"zz".repeat(20)}`, "2F8218c7cF6d822091EDe24Db9c46B0324c21A6F", 5, null]) {
      expect(addressSchema.safeParse(value).success, String(value)).toBe(false);
    }
  });
});
