"use client";

import { MAX_NOTE_LENGTH } from "@tesoreria/agent";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { post } from "../lib/client/api";
import { userMessage } from "../lib/client/errors";
import { MAX_PESOS, formatPesos, parsePesos } from "../lib/format";
import { Button, FIELD } from "./ui";

const OUTCOME: Record<string, string> = {
  reimbursed: "Listo: el agente te devolvió la plata.",
  proposed: "No entraba sin votación: el agente lo propuso y ahora lo vota el grupo.",
  waiting: "El fondo todavía no tiene esos pesos: el agente te lo devuelve cuando entren.",
  rejected: "El agente no puede devolver este gasto.",
  blocked: "No se pudo procesar ahora. El agente lo vuelve a intentar en un rato.",
  sending: "El agente ya lo mandó. En un rato aparece en los movimientos.",
  new: "El agente está ocupado: lo procesa en unos minutos.",
};

const outcome = (status: string) => OUTCOME[status] ?? OUTCOME.new!;

/** The same kind and amount this person loaded a few minutes ago, maybe from another tab: its status and amount. */
type Twin = { status: string; amount: bigint };

/** Cargar un gasto (spec, 9, pantalla 6): the agreed expense or another one, the amount and a note. */
export function ExpensePanel({ fund, agreedExpense }: { fund: string; agreedExpense: string }) {
  const router = useRouter();
  // One key per opening: a double click or a retry sends the same one, and the server keeps one expense.
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // a second click lands before the button re-renders as disabled
  const [twin, setTwin] = useState<Twin | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);

  async function submit(confirmDuplicate: boolean) {
    if (sending.current || form.current === null) return;
    const fields = new FormData(form.current);
    const amount = String(fields.get("amount") ?? "");
    const units = parsePesos(amount);
    if (units === null || units > MAX_PESOS) {
      setError(units === null ? "Escribilo como 10.000 o 10.000,50." : `No puede pasar de ${formatPesos(MAX_PESOS)}.`);
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const answer = await post<{ status: string; duplicateOf?: string }>(`/api/funds/${fund}/expenses`, {
        clientKey,
        kind: fields.get("kind"),
        amount,
        note: String(fields.get("note") ?? ""),
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
      setMessage(outcome(answer.status));
      router.refresh();
    } catch (caught) {
      setError(userMessage(caught));
      setBusy(false);
      sending.current = false;
    }
  }

  return (
    <form
      ref={form}
      className="grid gap-4"
      onChange={() => setTwin(null)} // a changed form is asked about again
      onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-semibold">¿Qué gasto es?</legend>
        <label className="flex min-h-11 items-center gap-3 rounded-[14px] bg-surface px-3">
          <input type="radio" name="kind" value="agreed" defaultChecked /> {agreedExpense} (el gasto acordado)
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-[14px] bg-surface px-3">
          <input type="radio" name="kind" value="other" /> Otro gasto (se vota)
        </label>
      </fieldset>
      <label className="grid gap-1">
        <span className="font-semibold">Cuánto pagaste</span>
        <input className={`${FIELD} money`} name="amount" required inputMode="decimal" autoComplete="off" placeholder="45.000" />
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">Nota (opcional)</span>
        <input className={FIELD} name="note" maxLength={MAX_NOTE_LENGTH} placeholder="La cancha del jueves" />
      </label>
      {message ? (
        <p role="status" className="rounded-[14px] bg-tint p-3 font-semibold text-primary">
          {message}
        </p>
      ) : twin !== null ? (
        <div className="grid gap-2">
          <p role="status" className="font-semibold">
            Hace unos minutos cargaste un gasto de <span className="money">{formatPesos(twin.amount)}</span>. ¿Es otro gasto igual?
          </p>
          <Button disabled={busy} onClick={() => submit(true)}>
            {busy ? "El agente lo está mirando…" : "Sí, es otro"}
          </Button>
          <Button variant="link" disabled={busy} onClick={() => setMessage(outcome(twin.status))}>
            No, es el mismo
          </Button>
        </div>
      ) : (
        <Button type="submit" disabled={busy}>
          {busy ? "El agente lo está mirando…" : "Cargar el gasto"}
        </Button>
      )}
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </form>
  );
}
