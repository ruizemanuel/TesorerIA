import { describe, expect, it } from "vitest";
import { personProblem, readDraft } from "../src/lib/checks";
import { MAX_PESOS, NBSP, WARS_UNIT, formatPesos } from "../src/lib/format";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";

const DRAFT = { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: "10.000", weeklyCap: "60.000" };

describe("readDraft", () => {
  it("reads a draft the way people write it, the amounts in wARS units", () => {
    expect(readDraft({ ...DRAFT, name: "  Fútbol de los jueves ", weeklyFee: "$ 10.000,50" }, "es")).toEqual({
      ok: true,
      draft: { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: 10_000n * WARS_UNIT + WARS_UNIT / 2n, weeklyCap: 60_000n * WARS_UNIT },
    });
  });

  it("says what to fix for an amount it can't read or nobody means, and for a name or an expense that doesn't fit", () => {
    const error = (change: Partial<typeof DRAFT>) => {
      const read = readDraft({ ...DRAFT, ...change }, "es");
      return read.ok ? "" : read.error;
    };
    for (const weeklyFee of ["abc", "0", "10,000.50", "10.5", ""]) {
      expect(error({ weeklyFee }), weeklyFee).toBe("No entendimos la cuota. Escribila como 10.000 o 10.000,50.");
    }
    expect(error({ weeklyCap: "1.0000" })).toBe("No entendimos el tope. Escribilo como 60.000 o 60.000,50.");
    expect(error({ weeklyFee: "1.000.000.000.001" })).toBe(`La cuota no puede pasar de ${formatPesos(MAX_PESOS, "es")}.`);
    expect(error({ weeklyCap: "1.000.000.000.001" })).toBe(`El tope no puede pasar de ${formatPesos(MAX_PESOS, "es")}.`);
    expect(error({ name: " " })).toBe("Poné un nombre para el fondo, de hasta 40 letras.");
    expect(error({ name: "x".repeat(41) })).toBe("Poné un nombre para el fondo, de hasta 40 letras.");
    expect(error({ agreedExpense: "" })).toBe("Poné cuál es el gasto acordado, de hasta 40 letras.");
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
    expect(readDraft({ name: "Thursday football", agreedExpense: "The pitch", weeklyFee: "10,000", weeklyCap: "60,000" }, "en")).toMatchObject({
      ok: true,
      draft: { weeklyFee: 10_000n * WARS_UNIT, weeklyCap: 60_000n * WARS_UNIT },
    });
    expect(readDraft({ name: "x", agreedExpense: "y", weeklyFee: "10.000", weeklyCap: "60,000" }, "en")).toEqual({
      ok: false,
      error: "We couldn't read the weekly dues. Write them like 10,000 or 10,000.50.",
    });
  });

  it("names every limit in English, with the biggest amount written the English way", () => {
    const error = (change: Partial<typeof DRAFT>) => {
      const read = readDraft({ ...DRAFT, weeklyFee: "10,000", weeklyCap: "60,000", ...change }, "en");
      return read.ok ? "" : read.error;
    };
    expect(error({ weeklyCap: "60.000" })).toBe("We couldn't read the weekly cap. Write it like 60,000 or 60,000.50.");
    expect(error({ weeklyFee: "1,000,000,000,001" })).toBe(`The weekly dues can't be more than ${formatPesos(MAX_PESOS, "en")}.`);
    expect(error({ weeklyCap: "1,000,000,000,001" })).toBe(`The weekly cap can't be more than ${formatPesos(MAX_PESOS, "en")}.`);
    expect(formatPesos(MAX_PESOS, "en")).toBe(`ARS${NBSP}1,000,000,000,000`);
    expect(error({ name: " " })).toBe("Enter a name for the fund, up to 40 letters.");
    expect(error({ agreedExpense: "" })).toBe("Enter what the agreed expense is, up to 40 letters.");
    expect(personProblem({ name: "Ema", email: "not-a-mail" }, en)).toBe("That email doesn't look valid.");
  });
});
