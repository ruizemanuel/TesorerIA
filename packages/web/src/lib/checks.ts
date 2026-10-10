import { MAX_PESOS, formatPesos, parsePesos } from "./format";

// What the forms check, shared by the browser (before the passkey is made: see withAccount) and the server, so
// both refuse the same things with the same sentence.

/** What's wrong with the name and mail of someone signing up, or null. */
export function personProblem({ name, email }: { name: string; email?: string }): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 30) return "Poné tu nombre, de hasta 30 letras.";
  const mail = email?.trim() || undefined;
  if (mail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return "Ese mail no parece válido.";
  return null;
}

export type DraftSettings = { name: string; agreedExpense: string; weeklyFee: bigint; weeklyCap: bigint };

/** What's wrong with a draft's settings, or null. Its texts are checked trimmed, as they're kept. */
export function draftProblem({ name, agreedExpense, weeklyFee, weeklyCap }: DraftSettings): string | null {
  const [fundName, expense] = [name.trim(), agreedExpense.trim()];
  if (fundName.length === 0 || fundName.length > 40) return "Poné un nombre para el fondo, de hasta 40 letras.";
  if (expense.length === 0 || expense.length > 40) return "Poné cuál es el gasto acordado, de hasta 40 letras.";
  if (weeklyFee <= 0n) return "La cuota tiene que ser más que cero.";
  if (weeklyCap <= 0n) return "El tope tiene que ser más que cero.";
  if (weeklyFee > MAX_PESOS) return `La cuota no puede pasar de ${formatPesos(MAX_PESOS)}.`;
  if (weeklyCap > MAX_PESOS) return `El tope no puede pasar de ${formatPesos(MAX_PESOS)}.`;
  return null;
}

/** A draft as the form has it, with its amounts read the Argentine way (`parsePesos`), or what to fix. */
export function readDraft(input: {
  name: string;
  agreedExpense: string;
  weeklyFee: string;
  weeklyCap: string;
}): { ok: true; draft: DraftSettings } | { ok: false; error: string } {
  const weeklyFee = parsePesos(input.weeklyFee);
  if (weeklyFee === null) return { ok: false, error: "No entendimos la cuota. Escribila como 10.000 o 10.000,50." };
  const weeklyCap = parsePesos(input.weeklyCap);
  if (weeklyCap === null) return { ok: false, error: "No entendimos el tope. Escribilo como 60.000 o 60.000,50." };
  const draft = { name: input.name.trim(), agreedExpense: input.agreedExpense.trim(), weeklyFee, weeklyCap };
  const problem = draftProblem(draft);
  return problem === null ? { ok: true, draft } : { ok: false, error: problem };
}
