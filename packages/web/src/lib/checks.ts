import { MAX_PESOS, amountExamples, formatMoney, parseMoney } from "./format";
import type { Messages } from "./i18n/messages";

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
  if (weeklyFee > MAX_PESOS) return m.checks.feeTooBig(formatMoney(MAX_PESOS, m));
  if (weeklyCap > MAX_PESOS) return m.checks.capTooBig(formatMoney(MAX_PESOS, m));
  return fundCapProblem(weeklyCap, m);
}

/**
 * Whether a weekly cap is above the fund's cap on its balance, which FundV2 reverts at creation, and what to say of it.
 * The cap is the one a new fund of `m`'s country gets, its currency's (createDraft keeps it in the draft); a draft that
 * already has one passes its own (`cap`), the one its createFund names.
 */
export function fundCapProblem(weeklyCap: bigint, m: Messages, cap: bigint = m.country.currency.limits.balanceCap): string | null {
  return weeklyCap > cap ? m.checks.capAboveFundCap(formatMoney(cap, m)) : null;
}

/** A draft as the form has it, with its amounts read the way `m` writes them (`parseMoney`), or what to fix in its words. */
export function readDraft(
  input: {
    name: string;
    agreedExpense: string;
    weeklyFee: string;
    weeklyCap: string;
  },
  m: Messages,
): { ok: true; draft: DraftSettings } | { ok: false; error: string } {
  const weeklyFee = parseMoney(input.weeklyFee, m);
  if (weeklyFee === null) return { ok: false, error: m.checks.feeUnreadable(...amountExamples(m.country.defaults.weeklyFee, m)) };
  const weeklyCap = parseMoney(input.weeklyCap, m);
  if (weeklyCap === null) return { ok: false, error: m.checks.capUnreadable(...amountExamples(m.country.defaults.weeklyCap, m)) };
  const draft = { name: input.name.trim(), agreedExpense: input.agreedExpense.trim(), weeklyFee, weeklyCap };
  const problem = draftProblem(draft, m);
  return problem === null ? { ok: true, draft } : { ok: false, error: problem };
}
