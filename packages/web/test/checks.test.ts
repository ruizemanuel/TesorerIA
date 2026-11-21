import { describe, expect, it } from "vitest";
import { fundCapProblem, personProblem, readDraft } from "../src/lib/checks";
import { COUNTRIES } from "../src/lib/countries";
import { MAX_PESOS, NBSP, WARS_UNIT, formatMoney } from "../src/lib/format";
import { messagesFor } from "../src/lib/i18n/messages";
import { en, es } from "./support/messages";

const DRAFT = { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: "10.000", weeklyCap: "60.000" };

describe("readDraft", () => {
  it("reads a draft the way people write it, the amounts in wARS units", () => {
    expect(readDraft({ ...DRAFT, name: "  Fútbol de los jueves ", weeklyFee: "$ 10.000,50" }, es)).toEqual({
      ok: true,
      draft: { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: 10_000n * WARS_UNIT + WARS_UNIT / 2n, weeklyCap: 60_000n * WARS_UNIT },
    });
  });

  it("says what to fix for an amount it can't read or nobody means, and for a name or an expense that doesn't fit", () => {
    const error = (change: Partial<typeof DRAFT>) => {
      const read = readDraft({ ...DRAFT, ...change }, es);
      return read.ok ? "" : read.error;
    };
    for (const weeklyFee of ["abc", "0", "10,000.50", "10.5", ""]) {
      expect(error({ weeklyFee }), weeklyFee).toBe("No entendimos la cuota. Escribila como 10.000 o 10.000,50.");
    }
    expect(error({ weeklyCap: "1.0000" })).toBe("No entendimos el tope. Escribilo como 60.000 o 60.000,50.");
    expect(error({ weeklyFee: "1.000.000.000.001" })).toBe(`La cuota no puede pasar de ${formatMoney(MAX_PESOS, es)}.`);
    expect(error({ weeklyCap: "1.000.000.000.001" })).toBe(`El tope no puede pasar de ${formatMoney(MAX_PESOS, es)}.`);
    expect(error({ name: " " })).toBe("Poné un nombre para el fondo, de hasta 40 letras.");
    expect(error({ name: "x".repeat(41) })).toBe("Poné un nombre para el fondo, de hasta 40 letras.");
    expect(error({ agreedExpense: "" })).toBe("Poné cuál es el gasto acordado, de hasta 40 letras.");
  });
});

describe("a weekly cap against the fund's cap", () => {
  it("refuses a weekly cap above the fund's cap", () => {
    expect(COUNTRIES.AR.currency.limits.balanceCap).toBe(450_000n * WARS_UNIT);
    const error = (weeklyCap: string, locale: "es" | "en" = "es") => {
      const read = readDraft({ ...DRAFT, weeklyFee: locale === "es" ? "10.000" : "10,000", weeklyCap }, locale === "es" ? es : en);
      return read.ok ? "" : read.error;
    };
    expect(error("450.001")).toBe(`El tope semanal no puede pasar el tope del fondo, de $${NBSP}450.000.`);
    expect(error("450,001", "en")).toBe(`The weekly cap can't be above the fund's cap of ARS${NBSP}450,000.`);
    expect(error("450.000,01")).toBe(`El tope semanal no puede pasar el tope del fondo, de $${NBSP}450.000.`);
    // Up to it, it's fine; the sentence for an amount nobody means still comes first.
    expect(readDraft({ ...DRAFT, weeklyCap: "450.000" }, es)).toMatchObject({ ok: true, draft: { weeklyCap: 450_000n * WARS_UNIT } });
    expect(error("1.000.000.000.001")).toBe(`El tope no puede pasar de ${formatMoney(MAX_PESOS, es)}.`);
  });

  it("caps a Mexican weekly cap at wMXN's balance cap, said the Mexican way", () => {
    const m = messagesFor("es", "MX");
    expect(fundCapProblem(600n * WARS_UNIT, m)).toBeNull();
    expect(fundCapProblem(5_000n * WARS_UNIT, m)).toBeNull();
    expect(fundCapProblem(6_000n * WARS_UNIT, m)).toBe(m.checks.capAboveFundCap("$5,000"));
    expect(fundCapProblem(6_000n * WARS_UNIT, m)).toBe("El tope semanal no puede superar el tope del fondo, de $5,000.");
    // The form reads it the Mexican way, and checks it against the same cap before the passkey is made.
    const read = readDraft({ ...DRAFT, weeklyFee: "100", weeklyCap: "5,000.01" }, m);
    expect(read).toEqual({ ok: false, error: m.checks.capAboveFundCap("$5,000") });
    // An Argentine one is still checked against wARS's.
    expect(fundCapProblem(6_000n * WARS_UNIT, es)).toBeNull();
  });

  it("teaches a Mexican amount with Mexico's defaults, $100 and $600, which fit under its cap", () => {
    const [mx, mxEn] = [messagesFor("es", "MX"), messagesFor("en", "MX")];
    const mexican = { ...DRAFT, weeklyFee: "100", weeklyCap: "600" };
    expect(readDraft({ ...mexican, weeklyFee: "10.000" }, mx)).toEqual({ ok: false, error: "No entendimos la cuota. Escríbela como 100 o 100.50." });
    expect(readDraft({ ...mexican, weeklyCap: "1.0000" }, mx)).toEqual({ ok: false, error: "No entendimos el tope. Escríbelo como 600 o 600.50." });
    expect(readDraft({ ...mexican, weeklyFee: "abc" }, mxEn)).toEqual({ ok: false, error: "We couldn't read the weekly dues. Write them like 100 or 100.50." });
    expect(readDraft({ ...mexican, weeklyCap: "60.000" }, mxEn)).toEqual({ ok: false, error: "We couldn't read the weekly cap. Write it like 600 or 600.50." });
    // Following the hint is never refused.
    expect(readDraft({ ...mexican, weeklyFee: "100.50", weeklyCap: "600.50" }, mx)).toMatchObject({ ok: true });
  });
});

describe("personProblem", () => {
  it("takes a name of up to 30 letters, and a mail only if it looks like one", () => {
    expect(personProblem({ name: "Ema" }, es)).toBeNull();
    expect(personProblem({ name: " Ema ", email: " ema@example.com " }, es)).toBeNull();
    expect(personProblem({ name: "Ema", email: "" }, es)).toBeNull();
    expect(personProblem({ name: "   " }, es)).toBe("Poné tu nombre, de hasta 30 letras.");
    expect(personProblem({ name: "x".repeat(31) }, es)).toBe("Poné tu nombre, de hasta 30 letras.");
    expect(personProblem({ name: "Ema", email: "not-a-mail" }, es)).toBe("Ese mail no parece válido.");
  });
});

describe("in English", () => {
  it("says what's wrong in English, and reads amounts the English way", () => {
    expect(personProblem({ name: "" }, es)).toBe("Poné tu nombre, de hasta 30 letras.");
    expect(personProblem({ name: "" }, en)).toBe("Enter your name, up to 30 letters.");
    expect(readDraft({ name: "Thursday football", agreedExpense: "The pitch", weeklyFee: "10,000", weeklyCap: "60,000" }, en)).toMatchObject({
      ok: true,
      draft: { weeklyFee: 10_000n * WARS_UNIT, weeklyCap: 60_000n * WARS_UNIT },
    });
    expect(readDraft({ name: "x", agreedExpense: "y", weeklyFee: "10.000", weeklyCap: "60,000" }, en)).toEqual({
      ok: false,
      error: "We couldn't read the weekly dues. Write them like 10,000 or 10,000.50.",
    });
  });

  it("names every limit in English, with the biggest amount written the English way", () => {
    const error = (change: Partial<typeof DRAFT>) => {
      const read = readDraft({ ...DRAFT, weeklyFee: "10,000", weeklyCap: "60,000", ...change }, en);
      return read.ok ? "" : read.error;
    };
    expect(error({ weeklyCap: "60.000" })).toBe("We couldn't read the weekly cap. Write it like 60,000 or 60,000.50.");
    expect(error({ weeklyFee: "1,000,000,000,001" })).toBe(`The weekly dues can't be more than ${formatMoney(MAX_PESOS, en)}.`);
    expect(error({ weeklyCap: "1,000,000,000,001" })).toBe(`The weekly cap can't be more than ${formatMoney(MAX_PESOS, en)}.`);
    expect(formatMoney(MAX_PESOS, en)).toBe(`ARS${NBSP}1,000,000,000,000`);
    expect(error({ name: " " })).toBe("Enter a name for the fund, up to 40 letters.");
    expect(error({ agreedExpense: "" })).toBe("Enter what the agreed expense is, up to 40 letters.");
    expect(personProblem({ name: "Ema", email: "not-a-mail" }, en)).toBe("That email doesn't look valid.");
  });
});
