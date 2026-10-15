import { describe, expect, it } from "vitest";
import {
  NBSP,
  USDT_UNIT,
  WARS_UNIT,
  formatPesos,
  formatUsdt,
  formatWhen,
  heldAmounts,
  initials,
  parsePesos,
  parsePesosEitherWay,
  parseUsdt,
} from "../src/lib/format";

describe("formatPesos", () => {
  it("writes pesos the Argentine way, with a space that doesn't break after the sign", () => {
    expect(formatPesos(87_500n * WARS_UNIT, "es")).toBe(`$${NBSP}87.500`);
    // Written out, not built from NBSP: a plain space here would break spec 9.1 and still match the constant.
    expect(formatPesos(87_500n * WARS_UNIT, "es")).toBe("$\u00A087.500");
    expect(formatPesos(0n, "es")).toBe(`$${NBSP}0`);
    expect(formatPesos(1_234_567n * WARS_UNIT, "es")).toBe(`$${NBSP}1.234.567`);
  });

  it("shows cents only when there are some, rounded half up", () => {
    expect(formatPesos(16_050n * WARS_UNIT + 37n * 10n ** 16n, "es")).toBe(`$${NBSP}16.050,37`);
    expect(formatPesos(10n * WARS_UNIT + 5n * 10n ** 15n, "es")).toBe(`$${NBSP}10,01`);
    expect(formatPesos(10n * WARS_UNIT + 4n * 10n ** 15n, "es")).toBe(`$${NBSP}10`);
    expect(formatPesos(-45_000n * WARS_UNIT, "es")).toBe(`-$${NBSP}45.000`);
  });
});

describe("formatUsdt", () => {
  it("writes USDT with up to two decimals", () => {
    expect(formatUsdt(10n * USDT_UNIT, "es")).toBe(`10${NBSP}USDT`);
    expect(formatUsdt(10n * USDT_UNIT, "es")).toBe("10\u00A0USDT");
    expect(formatUsdt(10_500_000n, "es")).toBe(`10,5${NBSP}USDT`);
    expect(formatUsdt(50_000n, "es")).toBe(`0,05${NBSP}USDT`);
    expect(formatUsdt(1_000n * USDT_UNIT, "es")).toBe(`1.000${NBSP}USDT`);
  });
});

describe("parsePesos", () => {
  it("reads amounts the way people write them in Argentina, and rejects the ambiguous ones", () => {
    expect(parsePesos("10.000", "es")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos("10000", "es")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos("10.000,50", "es")).toBe(10_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parsePesos("$ 10.000", "es")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos(`$${NBSP}45.000`, "es")).toBe(45_000n * WARS_UNIT);
    expect(parsePesos("10,5", "es")).toBe(10n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parsePesos("1.000.000", "es")).toBe(1_000_000n * WARS_UNIT);
    expect(parsePesos("1.000,5", "es")).toBe(1_000n * WARS_UNIT + 50n * 10n ** 16n);
    // A dot is always thousands here: "10.5" or "1.0000" would be read wrong either way, so they're refused.
    // So is a comma with three digits after it ("1,000" is a thousand in the US and a one in Argentina).
    // And a group of thousands never starts with a zero: "0.500" is neither 500 nor a half, so it's refused.
    for (const bad of ["10,000.50", "1.0000", "10.5", "10.00", "1000.000", "1,000", "0.500", "0.001", "00.500", "01.000", "10,555", "abc", "", "0", "0,00", "-5", "1e3"]) {
      expect(parsePesos(bad, "es"), bad).toBeNull();
    }
  });
});

describe("parseUsdt", () => {
  it("reads USDT written like pesos, to the cent", () => {
    expect(parseUsdt("6,25", "es")).toBe(6_250_000n);
    expect(parseUsdt("10", "es")).toBe(10_000_000n);
    expect(parseUsdt("1.000,5", "es")).toBe(1_000_500_000n);
    expect(parseUsdt(`6,25${NBSP}USDT`, "es")).toBe(6_250_000n);
    expect(parseUsdt("6.25", "es")).toBeNull();
    expect(parseUsdt("6,255", "es")).toBeNull();
    expect(parseUsdt("0", "es")).toBeNull();
  });
});

describe("formatWhen", () => {
  // 2026-10-10 12:00 in Buenos Aires (UTC-3).
  const now = new Date("2026-10-10T15:00:00Z");

  it("says today, yesterday, the weekday within the week, and the date after that, in Buenos Aires time", () => {
    expect(formatWhen(new Date("2026-10-10T13:15:00Z"), now, "es")).toBe("Hoy, 10:15");
    expect(formatWhen(new Date("2026-10-10T03:05:00Z"), now, "es")).toBe("Hoy, 0:05");
    expect(formatWhen(new Date("2026-10-10T02:59:00Z"), now, "es")).toBe("Ayer, 23:59");
    expect(formatWhen(new Date("2026-10-05T12:00:00Z"), now, "es")).toBe("Lunes, 9:00");
    expect(formatWhen(new Date("2026-10-03T12:00:00Z"), now, "es")).toBe("3/10");
  });
});

describe("heldAmounts", () => {
  it("says pesos, then USDT, and leaves out what rounds to zero", () => {
    expect(heldAmounts({ wars: 1_016_100_000_000_000_000_000n, usdt: 0n }, "es")).toEqual([`$${NBSP}1.016,10`]);
    expect(heldAmounts({ wars: 0n, usdt: 5n * USDT_UNIT }, "es")).toEqual([`5${NBSP}USDT`]);
    expect(heldAmounts({ wars: 10_000n * WARS_UNIT, usdt: 5n * USDT_UNIT }, "es")).toEqual([`$${NBSP}10.000`, `5${NBSP}USDT`]);
    expect(heldAmounts({ wars: 4n * 10n ** 15n, usdt: 4_999n }, "es")).toEqual([]); // under half a cent of each
    expect(heldAmounts({ wars: 5n * 10n ** 15n, usdt: 5_000n }, "es")).toEqual([`$${NBSP}0,01`, `0,01${NBSP}USDT`]);
  });
});

describe("initials", () => {
  it("takes two letters for the avatar", () => {
    expect(initials("Ema")).toBe("EM");
    expect(initials("juan pablo")).toBe("JP");
    expect(initials("  ")).toBe("?");
  });
});

describe("in English (spec, 9.3)", () => {
  it("writes pesos as ARS, with commas for thousands and a point for cents", () => {
    expect(formatPesos(87_500n * WARS_UNIT, "en")).toBe(`ARS${NBSP}87,500`);
    expect(formatPesos(16_050n * WARS_UNIT + 37n * 10n ** 16n, "en")).toBe(`ARS${NBSP}16,050.37`);
    expect(formatPesos(10n * WARS_UNIT + 5n * 10n ** 15n, "en")).toBe(`ARS${NBSP}10.01`);
    expect(formatPesos(-45_000n * WARS_UNIT, "en")).toBe(`-ARS${NBSP}45,000`);
    expect(formatPesos(0n, "en")).toBe(`ARS${NBSP}0`);
  });

  it("writes USDT with a point", () => {
    expect(formatUsdt(10_500_000n, "en")).toBe(`10.5${NBSP}USDT`);
    expect(formatUsdt(1_000n * USDT_UNIT, "en")).toBe(`1,000${NBSP}USDT`);
  });

  it("says what an account holds the English way", () => {
    expect(heldAmounts({ wars: 45_000n * WARS_UNIT, usdt: 1_200_000n }, "en")).toEqual([`ARS${NBSP}45,000`, `1.2${NBSP}USDT`]);
  });

  it("reads amounts the way they're written in English, and rejects the ambiguous ones", () => {
    expect(parsePesos("10,000", "en")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos("10000", "en")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos("10,000.50", "en")).toBe(10_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parsePesos("10000.5", "en")).toBe(10_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parsePesos("ARS 10,000", "en")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos(`ARS${NBSP}45,000`, "en")).toBe(45_000n * WARS_UNIT);
    expect(parsePesos("1,000,000", "en")).toBe(1_000_000n * WARS_UNIT);
    // A comma is always thousands, and a point always decimals: anything else is refused, never guessed.
    for (const bad of ["10.000", "10,00", "10.000,50", "1,0000", "1,000.555", "0,500", "01,000", "10.5.5", "$ 10,000", "abc", "", "0", "0.00", "-5", "1e3"]) {
      expect(parsePesos(bad, "en"), bad).toBeNull();
    }
  });

  it("reads the model's amount in either language's way", () => {
    expect(parsePesosEitherWay("45.000")).toBe(45_000n * WARS_UNIT);
    expect(parsePesosEitherWay("45,000")).toBe(45_000n * WARS_UNIT);
    expect(parsePesosEitherWay("45,000.50")).toBe(45_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parsePesosEitherWay("45.000,50")).toBe(45_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parsePesosEitherWay(`$${NBSP}8.000`)).toBe(8_000n * WARS_UNIT);
    expect(parsePesosEitherWay(`ARS${NBSP}8,000`)).toBe(8_000n * WARS_UNIT);
    expect(parsePesosEitherWay("forty")).toBeNull();
    expect(parsePesosEitherWay("0")).toBeNull();
    // Neither language reads these, so neither does the model's amount.
    for (const bad of ["10.5.5", "1,000.555", "", "-5"]) expect(parsePesosEitherWay(bad), bad).toBeNull();
  });

  it("reads USDT written the English way", () => {
    expect(parseUsdt("6.25", "en")).toBe(6_250_000n);
    expect(parseUsdt(`6.25${NBSP}USDT`, "en")).toBe(6_250_000n);
    expect(parseUsdt("1,000.5", "en")).toBe(1_000_500_000n);
    expect(parseUsdt("6,25", "en")).toBeNull();
    expect(parseUsdt("6.255", "en")).toBeNull();
  });

  it("says today, yesterday, the weekday and then the month in letters, in Buenos Aires time", () => {
    const now = new Date("2026-10-10T15:00:00Z");
    expect(formatWhen(new Date("2026-10-10T13:15:00Z"), now, "en")).toBe("Today, 10:15");
    expect(formatWhen(new Date("2026-10-10T03:05:00Z"), now, "en")).toBe("Today, 0:05");
    expect(formatWhen(new Date("2026-10-10T02:59:00Z"), now, "en")).toBe("Yesterday, 23:59");
    expect(formatWhen(new Date("2026-10-05T12:00:00Z"), now, "en")).toBe("Monday, 9:00");
    expect(formatWhen(new Date("2026-10-03T12:00:00Z"), now, "en")).toBe("Oct 3");
  });
});

describe("an amount typed in one language and read in the other (Review Focus 2)", () => {
  // A page shown in one language can be posted after the cookie changed in another tab: the server then reads the
  // amount with the other language's rules. Only digits read the same in both, so anything else must be refused by
  // one of them: never read as a different amount.
  it("is refused, or read as the same amount", () => {
    const written = ["10.000", "10,000", "10.5", "10,5", "1.000,50", "1,000.50", "1.5", "1,50", "100", "0,5", "0.5", "1.000.000", "1,000,000", "12.34", "12,34"];
    // Park-Miller: the product stays under 2^53, so the generator keeps going and the separators actually come up.
    let seed = 42;
    const next = () => (seed = (seed * 16_807) % 2_147_483_647);
    const random: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const length = 1 + (next() % 9);
      random.push(Array.from({ length }, () => "0123456789.,"[next() % 12]).join(""));
    }
    // Guards the generator itself: if it ever stops drawing "." and ",", the loop below proves nothing.
    expect(random.filter((text) => /[.,]/.test(text)).length).toBeGreaterThan(2_000);
    written.push(...random);
    for (const text of written) {
      const es = parsePesos(text, "es");
      const en = parsePesos(text, "en");
      if (es !== null && en !== null) expect(en, text).toBe(es);
    }
  });
});
