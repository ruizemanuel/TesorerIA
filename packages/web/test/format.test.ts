import { describe, expect, it } from "vitest";
import { COUNTRIES, type Speech } from "../src/lib/countries";
import {
  NBSP,
  USDT_UNIT,
  WARS_UNIT,
  downToCentavo,
  formatDay,
  formatForeignMoney,
  formatMoney,
  formatPercent,
  formatUsdt,
  formatWhen,
  heldAmounts,
  initials,
  parseMoney,
  parseMoneyInChat,
  parseUsdt,
} from "../src/lib/format";

const AR_ES: Speech = { locale: "es", country: COUNTRIES.AR };
const AR_EN: Speech = { locale: "en", country: COUNTRIES.AR };
const MX_ES: Speech = { locale: "es", country: COUNTRIES.MX };
const MX_EN: Speech = { locale: "en", country: COUNTRIES.MX };
const U = 10n ** 18n;

describe("formatMoney", () => {
  it("writes pesos the Argentine way, with a space that doesn't break after the sign", () => {
    expect(formatMoney(87_500n * WARS_UNIT, AR_ES)).toBe(`$${NBSP}87.500`);
    // Written out, not built from NBSP: a plain space here would break spec 9.1 and still match the constant.
    expect(formatMoney(87_500n * WARS_UNIT, AR_ES)).toBe("$\u00A087.500");
    expect(formatMoney(0n, AR_ES)).toBe(`$${NBSP}0`);
    expect(formatMoney(1_234_567n * WARS_UNIT, AR_ES)).toBe(`$${NBSP}1.234.567`);
  });

  it("shows cents only when there are some, rounded half up", () => {
    expect(formatMoney(16_050n * WARS_UNIT + 37n * 10n ** 16n, AR_ES)).toBe(`$${NBSP}16.050,37`);
    expect(formatMoney(10n * WARS_UNIT + 5n * 10n ** 15n, AR_ES)).toBe(`$${NBSP}10,01`);
    expect(formatMoney(10n * WARS_UNIT + 4n * 10n ** 15n, AR_ES)).toBe(`$${NBSP}10`);
    expect(formatMoney(-45_000n * WARS_UNIT, AR_ES)).toBe(`-$${NBSP}45.000`);
  });
});

describe("formatPercent", () => {
  it("writes basis points as a percentage, in each language's way: a v2 fund's fee", () => {
    expect(formatPercent(25, AR_ES)).toBe(`0,25${NBSP}%`);
    expect(formatPercent(25, AR_EN)).toBe("0.25%");
    expect([formatPercent(50, AR_ES), formatPercent(100, AR_ES), formatPercent(5, AR_ES)]).toEqual([`0,5${NBSP}%`, `1${NBSP}%`, `0,05${NBSP}%`]);
    expect([formatPercent(50, AR_EN), formatPercent(100, AR_EN), formatPercent(0, AR_EN)]).toEqual(["0.5%", "1%", "0%"]);
  });
});

describe("downToCentavo", () => {
  it("takes wARS units down to a whole centavo: the most a member can ask back, never over what they have", () => {
    expect(downToCentavo(10_000n * WARS_UNIT + 7_325n * 10n ** 12n)).toBe(10_000n * WARS_UNIT);
    expect(downToCentavo(10_000n * WARS_UNIT - 1n)).toBe(9_999n * WARS_UNIT + 99n * 10n ** 16n);
    expect(downToCentavo(5n * 10n ** 16n)).toBe(5n * 10n ** 16n);
  });
});

describe("formatUsdt", () => {
  it("writes USDT with up to two decimals", () => {
    expect(formatUsdt(10n * USDT_UNIT, AR_ES)).toBe(`10${NBSP}USDT`);
    expect(formatUsdt(10n * USDT_UNIT, AR_ES)).toBe("10\u00A0USDT");
    expect(formatUsdt(10_500_000n, AR_ES)).toBe(`10,5${NBSP}USDT`);
    expect(formatUsdt(50_000n, AR_ES)).toBe(`0,05${NBSP}USDT`);
    expect(formatUsdt(1_000n * USDT_UNIT, AR_ES)).toBe(`1.000${NBSP}USDT`);
  });
});

describe("parseMoney", () => {
  it("reads amounts the way people write them in Argentina, and rejects the ambiguous ones", () => {
    expect(parseMoney("10.000", AR_ES)).toBe(10_000n * WARS_UNIT);
    expect(parseMoney("10000", AR_ES)).toBe(10_000n * WARS_UNIT);
    expect(parseMoney("10.000,50", AR_ES)).toBe(10_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parseMoney("$ 10.000", AR_ES)).toBe(10_000n * WARS_UNIT);
    expect(parseMoney(`$${NBSP}45.000`, AR_ES)).toBe(45_000n * WARS_UNIT);
    expect(parseMoney("10,5", AR_ES)).toBe(10n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parseMoney("1.000.000", AR_ES)).toBe(1_000_000n * WARS_UNIT);
    expect(parseMoney("1.000,5", AR_ES)).toBe(1_000n * WARS_UNIT + 50n * 10n ** 16n);
    // A dot is always thousands here: "10.5" or "1.0000" would be read wrong either way, so they're refused.
    // So is a comma with three digits after it ("1,000" is a thousand in the US and a one in Argentina).
    // And a group of thousands never starts with a zero: "0.500" is neither 500 nor a half, so it's refused.
    for (const bad of ["10,000.50", "1.0000", "10.5", "10.00", "1000.000", "1,000", "0.500", "0.001", "00.500", "01.000", "10,555", "abc", "", "0", "0,00", "-5", "1e3"]) {
      expect(parseMoney(bad, AR_ES), bad).toBeNull();
    }
  });
});

describe("parseUsdt", () => {
  it("reads USDT written like pesos, to the cent", () => {
    expect(parseUsdt("6,25", AR_ES)).toBe(6_250_000n);
    expect(parseUsdt("10", AR_ES)).toBe(10_000_000n);
    expect(parseUsdt("1.000,5", AR_ES)).toBe(1_000_500_000n);
    expect(parseUsdt(`6,25${NBSP}USDT`, AR_ES)).toBe(6_250_000n);
    expect(parseUsdt("6.25", AR_ES)).toBeNull();
    expect(parseUsdt("6,255", AR_ES)).toBeNull();
    expect(parseUsdt("0", AR_ES)).toBeNull();
  });
});

describe("formatWhen", () => {
  // 2026-10-10 12:00 in Buenos Aires (UTC-3).
  const now = new Date("2026-10-10T15:00:00Z");

  it("says today, yesterday, the weekday within the week, and the date after that, in Buenos Aires time", () => {
    expect(formatWhen(new Date("2026-10-10T13:15:00Z"), now, AR_ES)).toBe("Hoy, 10:15");
    expect(formatWhen(new Date("2026-10-10T03:05:00Z"), now, AR_ES)).toBe("Hoy, 0:05");
    expect(formatWhen(new Date("2026-10-10T02:59:00Z"), now, AR_ES)).toBe("Ayer, 23:59");
    expect(formatWhen(new Date("2026-10-05T12:00:00Z"), now, AR_ES)).toBe("Lunes, 9:00");
    expect(formatWhen(new Date("2026-10-03T12:00:00Z"), now, AR_ES)).toBe("3/10");
  });
});

describe("formatDay", () => {
  it("writes a day as the movements do after a week, in Buenos Aires time (spec, 9.3)", () => {
    // The real fund's startTime: 2026-10-12 00:19:48 UTC is still the 11th in Buenos Aires.
    const start = new Date("2026-10-12T00:19:48Z");
    expect(formatDay(start, AR_ES)).toBe("11/10");
    expect(formatDay(start, AR_EN)).toBe("Oct 11");
    expect(formatDay(new Date("2026-10-19T00:19:48Z"), AR_ES)).toBe("18/10");
  });
});

describe("heldAmounts", () => {
  it("says pesos, then USDT, and leaves out what rounds to zero", () => {
    expect(heldAmounts({ currency: 1_016_100_000_000_000_000_000n, dollar: 0n }, AR_ES)).toEqual([`$${NBSP}1.016,10`]);
    expect(heldAmounts({ currency: 0n, dollar: 5n * USDT_UNIT }, AR_ES)).toEqual([`5${NBSP}USDT`]);
    expect(heldAmounts({ currency: 10_000n * WARS_UNIT, dollar: 5n * USDT_UNIT }, AR_ES)).toEqual([`$${NBSP}10.000`, `5${NBSP}USDT`]);
    expect(heldAmounts({ currency: 4n * 10n ** 15n, dollar: 4_999n }, AR_ES)).toEqual([]); // under half a cent of each
    expect(heldAmounts({ currency: 5n * 10n ** 15n, dollar: 5_000n }, AR_ES)).toEqual([`$${NBSP}0,01`, `0,01${NBSP}USDT`]);
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
    expect(formatMoney(87_500n * WARS_UNIT, AR_EN)).toBe(`ARS${NBSP}87,500`);
    expect(formatMoney(16_050n * WARS_UNIT + 37n * 10n ** 16n, AR_EN)).toBe(`ARS${NBSP}16,050.37`);
    expect(formatMoney(10n * WARS_UNIT + 5n * 10n ** 15n, AR_EN)).toBe(`ARS${NBSP}10.01`);
    expect(formatMoney(-45_000n * WARS_UNIT, AR_EN)).toBe(`-ARS${NBSP}45,000`);
    expect(formatMoney(0n, AR_EN)).toBe(`ARS${NBSP}0`);
  });

  it("writes USDT with a point", () => {
    expect(formatUsdt(10_500_000n, AR_EN)).toBe(`10.5${NBSP}USDT`);
    expect(formatUsdt(1_000n * USDT_UNIT, AR_EN)).toBe(`1,000${NBSP}USDT`);
  });

  it("says what an account holds the English way", () => {
    expect(heldAmounts({ currency: 45_000n * WARS_UNIT, dollar: 1_200_000n }, AR_EN)).toEqual([`ARS${NBSP}45,000`, `1.2${NBSP}USDT`]);
  });

  it("reads amounts the way they're written in English, and rejects the ambiguous ones", () => {
    expect(parseMoney("10,000", AR_EN)).toBe(10_000n * WARS_UNIT);
    expect(parseMoney("10000", AR_EN)).toBe(10_000n * WARS_UNIT);
    expect(parseMoney("10,000.50", AR_EN)).toBe(10_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parseMoney("10000.5", AR_EN)).toBe(10_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parseMoney("ARS 10,000", AR_EN)).toBe(10_000n * WARS_UNIT);
    expect(parseMoney(`ARS${NBSP}45,000`, AR_EN)).toBe(45_000n * WARS_UNIT);
    expect(parseMoney("1,000,000", AR_EN)).toBe(1_000_000n * WARS_UNIT);
    // A comma is always thousands, and a point always decimals: anything else is refused, never guessed.
    for (const bad of ["10.000", "10,00", "10.000,50", "1,0000", "1,000.555", "0,500", "01,000", "10.5.5", "$ 10,000", "abc", "", "0", "0.00", "-5", "1e3"]) {
      expect(parseMoney(bad, AR_EN), bad).toBeNull();
    }
  });

  it("reads the model's amount in either language's way", () => {
    expect(parseMoneyInChat("45.000", COUNTRIES.AR)).toBe(45_000n * WARS_UNIT);
    expect(parseMoneyInChat("45,000", COUNTRIES.AR)).toBe(45_000n * WARS_UNIT);
    expect(parseMoneyInChat("45,000.50", COUNTRIES.AR)).toBe(45_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parseMoneyInChat("45.000,50", COUNTRIES.AR)).toBe(45_000n * WARS_UNIT + 50n * 10n ** 16n);
    expect(parseMoneyInChat(`$${NBSP}8.000`, COUNTRIES.AR)).toBe(8_000n * WARS_UNIT);
    expect(parseMoneyInChat(`ARS${NBSP}8,000`, COUNTRIES.AR)).toBe(8_000n * WARS_UNIT);
    expect(parseMoneyInChat("forty", COUNTRIES.AR)).toBeNull();
    expect(parseMoneyInChat("0", COUNTRIES.AR)).toBeNull();
    // Neither language reads these, so neither does the model's amount.
    for (const bad of ["10.5.5", "1,000.555", "", "-5"]) expect(parseMoneyInChat(bad, COUNTRIES.AR), bad).toBeNull();
  });

  it("reads USDT written the English way", () => {
    expect(parseUsdt("6.25", AR_EN)).toBe(6_250_000n);
    expect(parseUsdt(`6.25${NBSP}USDT`, AR_EN)).toBe(6_250_000n);
    expect(parseUsdt("1,000.5", AR_EN)).toBe(1_000_500_000n);
    expect(parseUsdt("6,25", AR_EN)).toBeNull();
    expect(parseUsdt("6.255", AR_EN)).toBeNull();
  });

  it("says today, yesterday, the weekday and then the month in letters, in Buenos Aires time", () => {
    const now = new Date("2026-10-10T15:00:00Z");
    expect(formatWhen(new Date("2026-10-10T13:15:00Z"), now, AR_EN)).toBe("Today, 10:15");
    expect(formatWhen(new Date("2026-10-10T03:05:00Z"), now, AR_EN)).toBe("Today, 0:05");
    expect(formatWhen(new Date("2026-10-10T02:59:00Z"), now, AR_EN)).toBe("Yesterday, 23:59");
    expect(formatWhen(new Date("2026-10-05T12:00:00Z"), now, AR_EN)).toBe("Monday, 9:00");
    expect(formatWhen(new Date("2026-10-03T12:00:00Z"), now, AR_EN)).toBe("Oct 3");
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
      const es = parseMoney(text, AR_ES);
      const en = parseMoney(text, AR_EN);
      if (es !== null && en !== null) expect(en, text).toBe(es);
    }
  });
});

describe("in Mexico", () => {
  it("writes Mexican pesos like Mexico, in Spanish and in English", () => {
    expect(formatMoney(10_000n * U, MX_ES)).toBe("$10,000");
    expect(formatMoney((16_050_37n * U) / 100n, MX_ES)).toBe("$16,050.37");
    expect(formatMoney((16_050_37n * U) / 100n, MX_EN)).toBe(`MXN${NBSP}16,050.37`);
    expect(formatMoney(10_000n * U, AR_ES)).toBe(`$${NBSP}10.000`);
  });

  it("reads Mexican amounts with Mexico's separators and refuses the ambiguous ones", () => {
    expect(parseMoney("10,000.50", MX_ES)).toBe((10_000_50n * U) / 100n);
    expect(parseMoney("$10,000", MX_ES)).toBe(10_000n * U);
    expect(parseMoney("MXN 10,000", MX_EN)).toBe(10_000n * U);
    expect(parseMoney("10.000", MX_ES)).toBeNull();
    expect(parseMoney("1.000", MX_ES)).toBeNull();
  });

  it("writes another country's money with the screen's separators", () => {
    expect(formatForeignMoney((16_050_37n * U) / 100n, COUNTRIES.AR, MX_ES)).toBe(`ARS${NBSP}16,050.37`);
  });

  it("tells the time in the fund's country", () => {
    const at = new Date("2026-11-19T04:30:00Z"); // 01:30 in Buenos Aires, 22:30 the day before in Mexico City
    const now = new Date("2026-11-19T12:00:00Z");
    expect(formatWhen(at, now, AR_ES)).toBe("Hoy, 1:30");
    expect(formatWhen(at, now, MX_ES)).toBe("Ayer, 22:30");
  });

  it("writes the fee as Intl writes it in Mexico", () => {
    const expected = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 2 }).format(0.0025);
    expect(formatPercent(25, MX_ES)).toBe(expected);
    expect(formatPercent(25, AR_ES)).toBe(`0,25${NBSP}%`);
  });

  it("reads no chat amount as two different amounts within one country", () => {
    for (const text of ["1,000", "1.000", "10,5", "10.5", "1,000.50"]) {
      const es = parseMoney(text, MX_ES);
      const en = parseMoney(text, MX_EN);
      expect(es === null || en === null || es === en, text).toBe(true);
    }
  });
});
