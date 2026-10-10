import { describe, expect, it } from "vitest";
import { personProblem, readDraft } from "../src/lib/checks";
import { MAX_PESOS, WARS_UNIT, formatPesos } from "../src/lib/format";

const DRAFT = { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: "10.000", weeklyCap: "60.000" };

describe("readDraft", () => {
  it("reads a draft the way people write it, the amounts in wARS units", () => {
    expect(readDraft({ ...DRAFT, name: "  Fútbol de los jueves ", weeklyFee: "$ 10.000,50" })).toEqual({
      ok: true,
      draft: { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: 10_000n * WARS_UNIT + WARS_UNIT / 2n, weeklyCap: 60_000n * WARS_UNIT },
    });
  });

  it("says what to fix for an amount it can't read or nobody means, and for a name or an expense that doesn't fit", () => {
    const error = (change: Partial<typeof DRAFT>) => {
      const read = readDraft({ ...DRAFT, ...change });
      return read.ok ? "" : read.error;
    };
    for (const weeklyFee of ["abc", "0", "10,000.50", "10.5", ""]) {
      expect(error({ weeklyFee }), weeklyFee).toBe("No entendimos la cuota. Escribila como 10.000 o 10.000,50.");
    }
    expect(error({ weeklyCap: "1.0000" })).toBe("No entendimos el tope. Escribilo como 60.000 o 60.000,50.");
    expect(error({ weeklyFee: "1.000.000.000.001" })).toBe(`La cuota no puede pasar de ${formatPesos(MAX_PESOS)}.`);
    expect(error({ weeklyCap: "1.000.000.000.001" })).toBe(`El tope no puede pasar de ${formatPesos(MAX_PESOS)}.`);
    expect(error({ name: " " })).toBe("Poné un nombre para el fondo, de hasta 40 letras.");
    expect(error({ name: "x".repeat(41) })).toBe("Poné un nombre para el fondo, de hasta 40 letras.");
    expect(error({ agreedExpense: "" })).toBe("Poné cuál es el gasto acordado, de hasta 40 letras.");
  });
});

describe("personProblem", () => {
  it("takes a name of up to 30 letters, and a mail only if it looks like one", () => {
    expect(personProblem({ name: "Ema" })).toBeNull();
    expect(personProblem({ name: " Ema ", email: " ema@example.com " })).toBeNull();
    expect(personProblem({ name: "Ema", email: "" })).toBeNull();
    expect(personProblem({ name: "   " })).toBe("Poné tu nombre, de hasta 30 letras.");
    expect(personProblem({ name: "x".repeat(31) })).toBe("Poné tu nombre, de hasta 30 letras.");
    expect(personProblem({ name: "Ema", email: "not-a-mail" })).toBe("Ese mail no parece válido.");
  });
});
