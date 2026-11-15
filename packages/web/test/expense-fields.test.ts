import { describe, expect, it } from "vitest";
import { expenseFields, panelOutcome } from "../src/lib/expense-fields";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";

describe("expenseFields: what the Cargar gasto panel asks, by the kind chosen", () => {
  it("asks how much was paid, with an optional note, for an expense", () => {
    for (const kind of ["agreed", "other"]) {
      expect(expenseFields(kind, es), kind).toEqual({
        amountLabel: "Cuánto pagaste",
        noteLabel: "Nota (opcional)",
        notePlaceholder: "La cancha del jueves",
        submit: "Cargar el gasto",
      });
    }
  });

  it("asks how much is given back and why, for a contribution given back (spec, 7.3)", () => {
    expect(expenseFields("give-back", es)).toEqual({
      amountLabel: "Cuánto te devolvemos",
      noteLabel: "¿Por qué?",
      notePlaceholder: "Deposité en otro fondo",
      submit: "Pedir la devolución",
    });
    expect(expenseFields("give-back", en)).toEqual({
      amountLabel: "How much we give back",
      noteLabel: "Why?",
      notePlaceholder: "I deposited into another fund",
      submit: "Ask for it back",
    });
  });
});

describe("panelOutcome", () => {
  it("says a contribution given back went to the vote in its own words, and anything else as the agent's card does", () => {
    expect(panelOutcome("give-back", "proposed", es)).toBe("El agente propuso devolvértelo y ahora lo vota el grupo.");
    expect(panelOutcome("give-back", "proposed", en)).toBe("The agent proposed giving it back to you, and now the group votes on it.");
    expect(panelOutcome("other", "proposed", es)).toBe(es.outcome.proposed);
    expect(panelOutcome("give-back", "blocked", es)).toBe(es.outcome.blocked);
  });
});
