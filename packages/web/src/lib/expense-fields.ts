import { expenseOutcome } from "./expense-outcome";
import type { Messages } from "./i18n/messages";

/** The kind of expense the Cargar gasto panel sends: "give-back" is part of a contribution, given back (spec, 7.3). */
export type ExpenseKind = "agreed" | "other" | "give-back";

/** What the Cargar gasto panel asks, by the kind chosen: a contribution given back asks how much and why. */
export function expenseFields(kind: string, m: Messages) {
  const e = m.expense;
  return kind === "give-back"
    ? { amountLabel: e.giveBackAmountLabel, noteLabel: e.giveBackNoteLabel, notePlaceholder: e.giveBackNotePlaceholder, submit: e.giveBackSubmit }
    : { amountLabel: e.amountLabel, noteLabel: e.noteLabel, notePlaceholder: e.notePlaceholder, submit: e.submit };
}

/** What happened to what the panel sent: a contribution given back always goes to the vote, and says so in its own words. */
export function panelOutcome(kind: string, status: string, m: Messages): string {
  return kind === "give-back" && status === "proposed" ? m.expense.giveBackProposed : expenseOutcome(status, m);
}
