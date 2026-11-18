"use client";

import { MAX_NOTE_LENGTH } from "@tesoreria/agent";
import { useRef, useState } from "react";
import { post } from "../lib/client/api";
import { userMessage } from "../lib/client/errors";
import { type ExpenseKind, expenseFields, expenseLimits, panelOutcome } from "../lib/expense-fields";
import { MAX_PESOS, formatPesos, parsePesos } from "../lib/format";
import { useLocale, useMessages } from "../lib/i18n/client";
import { useRefresh } from "./refresh-provider";
import { Button, FIELD } from "./ui";

/** The same kind and amount this person loaded a few minutes ago, maybe from another tab: its status and amount. */
type Twin = { status: string; amount: bigint };

/**
 * Cargar un gasto (spec, 9, pantalla 6): the agreed expense, another one, or part of a contribution given back (spec,
 * 7.3), the amount and a note. What the fields ask follows the kind chosen. In a version 2 fund it also says how many of
 * this week's proposals the member has left (`proposalsLeft`) and the most a give-back can ask (`giveBackMax`), and
 * doesn't send one over it (FundScreen).
 */
export function ExpensePanel({
  fund,
  agreedExpense,
  proposalsLeft,
  giveBackMax,
}: {
  fund: string;
  agreedExpense: string;
  proposalsLeft: number | null;
  giveBackMax: bigint | null;
}) {
  const m = useMessages();
  const locale = useLocale();
  const { refresh } = useRefresh();
  // One key per opening: a double click or a retry sends the same one, and the server keeps one expense.
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // a second click lands before the button re-renders as disabled
  const [twin, setTwin] = useState<Twin | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<ExpenseKind>("agreed");
  const fields = expenseFields(kind, m);
  const limits = expenseLimits(kind, { proposalsLeft, giveBackMax }, m);
  const form = useRef<HTMLFormElement>(null);

  async function submit(confirmDuplicate: boolean) {
    if (sending.current || form.current === null) return;
    const data = new FormData(form.current);
    const amount = String(data.get("amount") ?? "");
    // With the page's language, the same one the route reads the amount with.
    const units = parsePesos(amount, locale);
    if (units === null || units > MAX_PESOS) {
      setError(units === null ? m.errors.amountFormat : m.errors.amountTooBig(formatPesos(MAX_PESOS, locale)));
      return;
    }
    // The agent gives back no more than what counts as contributed, to the wei: more isn't sent, and the panel says why.
    if (limits.giveBackMax !== null && giveBackMax !== null && units > giveBackMax) {
      setError(limits.giveBackMax);
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const answer = await post<{ status: string; duplicateOf?: string }>(`/api/funds/${fund}/expenses`, {
        clientKey,
        kind,
        amount,
        note: String(data.get("note") ?? ""),
        confirmDuplicate,
      });
      if (answer.duplicateOf !== undefined) {
        // If it is another expense, it goes with a fresh key, made once, so retrying the answer keeps one.
        setClientKey(crypto.randomUUID());
        setTwin({ status: answer.status, amount: units });
        setBusy(false);
        sending.current = false;
        return;
      }
      setMessage(panelOutcome(kind, answer.status, m));
      refresh();
    } catch (caught) {
      setError(userMessage(caught, m));
      setBusy(false);
      sending.current = false;
    }
  }

  return (
    <form
      ref={form}
      // Submitted before hydration, it goes out as the browser's own submit: by POST, its fields stay out of the URL.
      method="post"
      className="grid gap-4"
      onChange={() => setTwin(null)} // a changed form is asked about again
      onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-semibold">{m.expense.which}</legend>
        <label className="flex min-h-11 items-center gap-3 rounded-[14px] bg-surface px-3">
          <input type="radio" name="kind" value="agreed" checked={kind === "agreed"} onChange={() => setKind("agreed")} />{" "}
          {m.expense.agreed(agreedExpense)}
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-[14px] bg-surface px-3">
          <input type="radio" name="kind" value="other" checked={kind === "other"} onChange={() => setKind("other")} /> {m.expense.other}
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-[14px] bg-surface px-3">
          <input type="radio" name="kind" value="give-back" checked={kind === "give-back"} onChange={() => setKind("give-back")} />{" "}
          {m.expense.giveBack}
        </label>
      </fieldset>
      {limits.quota !== null && <p className="text-sm text-muted">{limits.quota}</p>}
      <label className="grid gap-1">
        <span className="font-semibold">{fields.amountLabel}</span>
        <input className={`${FIELD} money`} name="amount" required inputMode="decimal" autoComplete="off" placeholder={m.expense.amountPlaceholder} />
        {limits.giveBackMax !== null && <span className="text-sm text-muted">{limits.giveBackMax}</span>}
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">{fields.noteLabel}</span>
        <input className={FIELD} name="note" maxLength={MAX_NOTE_LENGTH} placeholder={fields.notePlaceholder} />
      </label>
      {message ? (
        <p role="status" className="rounded-[14px] bg-tint p-3 font-semibold text-primary">
          {message}
        </p>
      ) : twin !== null ? (
        <div className="grid gap-2">
          <p role="status" className="font-semibold">
            {m.expense.twin(<span className="money">{formatPesos(twin.amount, locale)}</span>)}
          </p>
          <Button disabled={busy} onClick={() => submit(true)}>
            {busy ? m.expense.looking : m.expense.another}
          </Button>
          <Button variant="link" disabled={busy} onClick={() => setMessage(panelOutcome(kind, twin.status, m))}>
            {m.expense.same}
          </Button>
        </div>
      ) : (
        <Button type="submit" disabled={busy}>
          {busy ? m.expense.looking : fields.submit}
        </Button>
      )}
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </form>
  );
}
