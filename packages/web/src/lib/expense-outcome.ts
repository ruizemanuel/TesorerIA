import type { Messages } from "./i18n/messages";

/** What happened to an expense a member loaded, by its status: the Cargar gasto panel and the chat's card say the same. */
export function expenseOutcome(status: string, m: Messages): string {
  // The status comes from the server: a word that is none of ours (even "constructor") is the expense not looked at yet.
  const outcomes: Record<string, string> = m.outcome;
  return Object.hasOwn(outcomes, status) ? outcomes[status]! : m.outcome.new;
}
