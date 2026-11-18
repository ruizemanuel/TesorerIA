import { describe, expect, it } from "vitest";
import { expenseFields, expenseLimits, panelOutcome } from "../src/lib/expense-fields";
import { NBSP, WARS_UNIT } from "../src/lib/format";
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

  it("says an expense waits for next week's proposals, whatever its kind", () => {
    for (const kind of ["other", "give-back"]) {
      expect(panelOutcome(kind, "quota", es), kind).toBe("Ya se usaron los pedidos que se votan de esta semana: el agente lo propone cuando empiece la próxima.");
    }
    expect(panelOutcome("other", "quota", en)).toBe("This week's requests that go to a vote are used up: the agent proposes it when next week starts.");
  });
});

describe("expenseLimits: what a v2 fund's panel says under the kinds", () => {
  const v2 = { proposalsLeft: 3, giveBackMax: 10_000n * WARS_UNIT + 7_325n * 10n ** 12n };
  const $ = (text: string) => text.replaceAll("$ ", `$${NBSP}`).replaceAll("ARS ", `ARS${NBSP}`);

  it("says how many requests that go to a vote are left, for another expense or a give-back, and none for the agreed one", () => {
    expect(expenseLimits("other", v2, es).quota).toBe("Te quedan 3 pedidos que se votan esta semana.");
    expect(expenseLimits("give-back", v2, es).quota).toBe("Te quedan 3 pedidos que se votan esta semana.");
    expect(expenseLimits("other", { ...v2, proposalsLeft: 1 }, es).quota).toBe("Te queda 1 pedido que se vota esta semana.");
    expect(expenseLimits("other", { ...v2, proposalsLeft: 0 }, es).quota).toBe(
      "Ya usaste los pedidos que se votan de esta semana: si lo cargás, el agente lo propone cuando empiece la próxima.",
    );
    expect(expenseLimits("agreed", v2, es).quota).toBeNull();
    expect(expenseLimits("other", v2, en).quota).toBe("You have 3 requests left this week that go to a vote.");
    expect(expenseLimits("other", { ...v2, proposalsLeft: 1 }, en).quota).toBe("You have 1 request left this week that goes to a vote.");
    expect(expenseLimits("other", { ...v2, proposalsLeft: 0 }, en).quota).toBe(
      "You've used this week's requests that go to a vote: if you add it, the agent proposes it when next week starts.",
    );
  });

  it("says the most a give-back can ask, down to the centavo, so the amount it shows is never too much", () => {
    expect(expenseLimits("give-back", v2, es).giveBackMax).toBe($("Podés pedir hasta $ 10.000, lo que cuenta como aportado."));
    expect(expenseLimits("give-back", { ...v2, giveBackMax: 10_000n * WARS_UNIT - 1n }, es).giveBackMax).toBe(
      $("Podés pedir hasta $ 9.999,99, lo que cuenta como aportado."),
    );
    expect(expenseLimits("give-back", v2, en).giveBackMax).toBe($("You can ask for up to ARS 10,000, what counts as contributed."));
    expect(expenseLimits("other", v2, es).giveBackMax).toBeNull();
  });

  it("says nothing in a v1 fund, which has neither limit", () => {
    for (const kind of ["agreed", "other", "give-back"]) {
      expect(expenseLimits(kind, { proposalsLeft: null, giveBackMax: null }, es), kind).toEqual({ quota: null, giveBackMax: null });
    }
  });
});
