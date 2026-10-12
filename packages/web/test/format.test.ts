import { describe, expect, it } from "vitest";
import { NBSP, USDT_UNIT, WARS_UNIT, formatPesos, formatUsdt, formatWhen, initials, parsePesos } from "../src/lib/format";

describe("formatPesos", () => {
  it("writes pesos the Argentine way, with a space that doesn't break after the sign", () => {
    expect(formatPesos(87_500n * WARS_UNIT)).toBe(`$${NBSP}87.500`);
    // Written out, not built from NBSP: a plain space here would break spec 9.1 and still match the constant.
    expect(formatPesos(87_500n * WARS_UNIT)).toBe("$\u00A087.500");
    expect(formatPesos(0n)).toBe(`$${NBSP}0`);
    expect(formatPesos(1_234_567n * WARS_UNIT)).toBe(`$${NBSP}1.234.567`);
  });

  it("shows cents only when there are some, rounded half up", () => {
    expect(formatPesos(16_050n * WARS_UNIT + 37n * 10n ** 16n)).toBe(`$${NBSP}16.050,37`);
    expect(formatPesos(10n * WARS_UNIT + 5n * 10n ** 15n)).toBe(`$${NBSP}10,01`);
    expect(formatPesos(10n * WARS_UNIT + 4n * 10n ** 15n)).toBe(`$${NBSP}10`);
    expect(formatPesos(-45_000n * WARS_UNIT)).toBe(`-$${NBSP}45.000`);
  });
});

describe("formatUsdt", () => {
  it("writes USDT with up to two decimals", () => {
    expect(formatUsdt(10n * USDT_UNIT)).toBe(`10${NBSP}USDT`);
    expect(formatUsdt(10n * USDT_UNIT)).toBe("10\u00A0USDT");
    expect(formatUsdt(10_500_000n)).toBe(`10,5${NBSP}USDT`);
    expect(formatUsdt(50_000n)).toBe(`0,05${NBSP}USDT`);
    expect(formatUsdt(1_000n * USDT_UNIT)).toBe(`1.000${NBSP}USDT`);
  });
});

describe("parsePesos", () => {
  it("reads amounts the way people write them in Argentina, and rejects the ambiguous ones", () => {
    expect(parsePesos("10.000")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos("10000")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos("10.000,50")).toBe(10_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parsePesos("$ 10.000")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos(`$${NBSP}45.000`)).toBe(45_000n * WARS_UNIT);
    expect(parsePesos("10,5")).toBe(10n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parsePesos("1.000.000")).toBe(1_000_000n * WARS_UNIT);
    expect(parsePesos("1.000,5")).toBe(1_000n * WARS_UNIT + 50n * 10n ** 16n);
    // A dot is always thousands here: "10.5" or "1.0000" would be read wrong either way, so they're refused.
    // So is a comma with three digits after it ("1,000" is a thousand in the US and a one in Argentina).
    // And a group of thousands never starts with a zero: "0.500" is neither 500 nor a half, so it's refused.
    for (const bad of ["10,000.50", "1.0000", "10.5", "10.00", "1000.000", "1,000", "0.500", "0.001", "00.500", "01.000", "10,555", "abc", "", "0", "0,00", "-5", "1e3"]) {
      expect(parsePesos(bad), bad).toBeNull();
    }
  });
});

describe("formatWhen", () => {
  // 2026-10-10 12:00 in Buenos Aires (UTC-3).
  const now = new Date("2026-10-10T15:00:00Z");

  it("says today, yesterday, the weekday within the week, and the date after that, in Buenos Aires time", () => {
    expect(formatWhen(new Date("2026-10-10T13:15:00Z"), now)).toBe("Hoy, 10:15");
    expect(formatWhen(new Date("2026-10-10T03:05:00Z"), now)).toBe("Hoy, 0:05");
    expect(formatWhen(new Date("2026-10-10T02:59:00Z"), now)).toBe("Ayer, 23:59");
    expect(formatWhen(new Date("2026-10-05T12:00:00Z"), now)).toBe("Lunes, 9:00");
    expect(formatWhen(new Date("2026-10-03T12:00:00Z"), now)).toBe("3/10");
  });
});

describe("initials", () => {
  it("takes two letters for the avatar", () => {
    expect(initials("Ema")).toBe("EM");
    expect(initials("juan pablo")).toBe("JP");
    expect(initials("  ")).toBe("?");
  });
});
