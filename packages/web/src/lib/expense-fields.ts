import { expenseOutcome } from "./expense-outcome";
import { downToCentavo, formatMoney } from "./format";
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

/**
 * What the Cargar gasto panel says of a version 2 fund's limits, by the kind chosen (FundScreen): for another expense or
 * a give-back, which go to a vote, how many of this week's proposals the member has left; for a give-back, the most it
 * can ask, down to the centavo, so that the amount it shows never asks for more than they have. Null where there's
 * nothing to say: version 1 has neither limit.
 */
export function expenseLimits(
  kind: string,
  { proposalsLeft, giveBackMax }: { proposalsLeft: number | null; giveBackMax: bigint | null },
  m: Messages,
): { quota: string | null; giveBackMax: string | null } {
  const e = m.expense;
  const voted = kind === "other" || kind === "give-back";
  return {
    quota: !voted || proposalsLeft === null ? null : proposalsLeft > 0 ? e.proposalsLeft(proposalsLeft) : e.noProposalsLeft,
    giveBackMax: kind !== "give-back" || giveBackMax === null ? null : e.giveBackMax(formatMoney(downToCentavo(giveBackMax), m)),
  };
}
