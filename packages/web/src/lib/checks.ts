import { MAX_PESOS, formatPesos, parsePesos } from "./format";
import type { Locale } from "./i18n/locales";
import { type Messages, messagesFor } from "./i18n/messages";

// What the forms check, shared by the browser (before the passkey is made: see withAccount) and the server, so
// both refuse the same things with the same sentence, in the language of the person (`m`).

/** What's wrong with the name and mail of someone signing up, or null. */
export function personProblem({ name, email }: { name: string; email?: string }, m: Messages): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 30) return m.checks.personName;
  const mail = email?.trim() || undefined;
  if (mail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return m.checks.personEmail;
  return null;
}

export type DraftSettings = { name: string; agreedExpense: string; weeklyFee: bigint; weeklyCap: bigint };

/** What's wrong with a draft's settings, or null. Its texts are checked trimmed, as they're kept. */
export function draftProblem({ name, agreedExpense, weeklyFee, weeklyCap }: DraftSettings, m: Messages): string | null {
  const [fundName, expense] = [name.trim(), agreedExpense.trim()];
  if (fundName.length === 0 || fundName.length > 40) return m.checks.fundName;
  if (expense.length === 0 || expense.length > 40) return m.checks.agreedExpense;
  if (weeklyFee <= 0n) return m.checks.feeZero;
  if (weeklyCap <= 0n) return m.checks.capZero;
  if (weeklyFee > MAX_PESOS) return m.checks.feeTooBig(formatPesos(MAX_PESOS, m.locale));
  if (weeklyCap > MAX_PESOS) return m.checks.capTooBig(formatPesos(MAX_PESOS, m.locale));
  return null;
}

/** A draft as the form has it, with its amounts read the way `locale` writes them (`parsePesos`), or what to fix. */
export function readDraft(
  input: {
    name: string;
    agreedExpense: string;
    weeklyFee: string;
    weeklyCap: string;
  },
  locale: Locale,
): { ok: true; draft: DraftSettings } | { ok: false; error: string } {
  const m = messagesFor(locale);
  const weeklyFee = parsePesos(input.weeklyFee, locale);
  if (weeklyFee === null) return { ok: false, error: m.checks.feeUnreadable };
  const weeklyCap = parsePesos(input.weeklyCap, locale);
  if (weeklyCap === null) return { ok: false, error: m.checks.capUnreadable };
  const draft = { name: input.name.trim(), agreedExpense: input.agreedExpense.trim(), weeklyFee, weeklyCap };
  const problem = draftProblem(draft, m);
  return problem === null ? { ok: true, draft } : { ok: false, error: problem };
}
