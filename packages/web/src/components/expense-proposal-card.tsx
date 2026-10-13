"use client";

import { useRef, useState } from "react";
import { CHAT_BAD_CARD } from "../lib/chat/texts";
import type { ChatUIMessage } from "../lib/chat/tools";
import { type ProposalRules, proposalPreview } from "../lib/chat/view";
import { post } from "../lib/client/api";
import { userMessage } from "../lib/client/errors";
import { expenseOutcome } from "../lib/expense-outcome";
import { formatPesos } from "../lib/format";
import { useConfirmingCards } from "./chat-provider";
import { useRefresh } from "./refresh-provider";
import { Button } from "./ui";

export type ProposalPart = Extract<ChatUIMessage["parts"][number], { type: "tool-proposeExpense" }>;

/**
 * The card the agent shows to load an expense (spec, 9.2). The member confirms it: it goes through the same route as
 * the Cargar gasto panel, with the tool call's id as its key, so a double tap keeps one expense. Its answer goes back
 * to the conversation without asking the model again.
 */
export function ExpenseProposalCard({
  part,
  fund,
  rules,
  onAnswer,
}: {
  part: ProposalPart;
  fund: string;
  rules: ProposalRules;
  onAnswer: (status: string) => Promise<void>;
}) {
  const { refresh } = useRefresh();
  const confirming = useConfirmingCards();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [twin, setTwin] = useState<{ status: string; amount: bigint } | null>(null);
  const [error, setError] = useState("");

  if (part.state === "input-streaming") return null;
  if (part.state === "output-error") return <p className="rounded-[14px] bg-surface p-3">{CHAT_BAD_CARD}</p>;
  if (part.state === "output-available") {
    const status = part.output.status;
    return (
      <p role="status" className="rounded-[14px] bg-tint p-3 font-semibold text-primary">
        {status === "dismissed" ? "No lo cargué." : expenseOutcome(status)}
      </p>
    );
  }
  if (part.state !== "input-available") return null;
  const preview = proposalPreview(part.input, rules);
  if (preview.amount === null) return <p className="rounded-[14px] bg-surface p-3">{CHAT_BAD_CARD}</p>;
  const units = preview.amount;
  const toolCallId = part.toolCallId;
  const input = part.input;

  async function confirm(confirmDuplicate: boolean) {
    // `confirming` outlives the card: a panel closed and reopened mid-request remounts it with `sending` reset.
    if (sending.current || confirming.has(toolCallId)) return;
    sending.current = true;
    confirming.add(toolCallId);
    setBusy(true);
    setError("");
    try {
      const answer = await post<{ status: string; duplicateOf?: string }>(`/api/funds/${fund}/expenses`, {
        // The same key for a retry of the same card; another one once the member says it's another expense.
        clientKey: confirmDuplicate ? `${toolCallId}:another` : toolCallId,
        kind: input.kind,
        amount: input.amount,
        note: input.note,
        confirmDuplicate,
      });
      if (answer.duplicateOf !== undefined) {
        setTwin({ status: answer.status, amount: units });
        return;
      }
      await onAnswer(answer.status);
      refresh();
    } catch (caught) {
      setError(userMessage(caught));
    } finally {
      confirming.delete(toolCallId);
      setBusy(false);
      sending.current = false;
    }
  }

  return (
    <div className="grid gap-3 rounded-[14px] border border-line bg-surface p-3">
      <p className="font-bold">Cargar gasto</p>
      <dl className="grid gap-1 text-sm">
        <div>
          <dt className="sr-only">Qué gasto es</dt>
          <dd>{preview.kind}</dd>
        </div>
        <div>
          <dt className="sr-only">Cuánto</dt>
          <dd className="money text-lg font-bold">{formatPesos(units)}</dd>
        </div>
        {preview.note !== "" && (
          <div>
            <dt className="sr-only">Nota</dt>
            <dd>{preview.note}</dd>
          </div>
        )}
      </dl>
      <p className="text-sm text-muted">{preview.next}</p>
      {twin !== null ? (
        <div className="grid gap-2">
          <p role="status" className="font-semibold">
            Hace unos minutos cargaste un gasto de <span className="money">{formatPesos(twin.amount)}</span>. ¿Es otro gasto igual?
          </p>
          <Button disabled={busy} onClick={() => confirm(true)}>
            {busy ? "El agente lo está mirando…" : "Sí, es otro"}
          </Button>
          <Button variant="link" disabled={busy} onClick={() => onAnswer(twin.status)}>
            No, es el mismo
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <Button disabled={busy} onClick={() => confirm(false)}>
            {busy ? "El agente lo está mirando…" : "Confirmar"}
          </Button>
          <Button variant="link" disabled={busy} onClick={() => onAnswer("dismissed")}>
            Cancelar
          </Button>
        </div>
      )}
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </div>
  );
}
