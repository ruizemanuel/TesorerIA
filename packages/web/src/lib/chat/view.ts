import { APICallError } from "ai";
import { formatPesos, parsePesos } from "../format";
import { CHAT_BAD_REQUEST, CHAT_LONG_MESSAGE, CHAT_MEMBER_LIMIT, CHAT_NOT_FOUND, CHAT_SEND_FAILED, CHAT_UNAVAILABLE } from "./texts";
import type { ChatUIMessage, ProposedExpense } from "./tools";

/** What the card needs from the fund to say what will happen (spec, 9.2). */
export type ProposalRules = { agreedExpense: string; leftThisWeek: bigint; votesRequired: number; members: number };

/** The card before it's confirmed: the kind, the amount (null if it can't be read), the note, and what comes next. */
export function proposalPreview(input: ProposedExpense, rules: ProposalRules) {
  const amount = parsePesos(input.amount);
  return {
    kind: input.kind === "agreed" ? `${rules.agreedExpense} (el gasto acordado)` : "Otro gasto",
    amount,
    note: input.note,
    next:
      input.kind === "agreed"
        ? `Si entra en lo que queda del tope de la semana (${formatPesos(rules.leftThisWeek)}), te lo devuelvo enseguida. Si no, se vota.`
        : `Se vota: necesita ${rules.votesRequired} de ${rules.members} votos.`,
  };
}

const OURS = new Set([CHAT_UNAVAILABLE, CHAT_MEMBER_LIMIT, CHAT_LONG_MESSAGE, CHAT_BAD_REQUEST, CHAT_NOT_FOUND]);

/**
 * What the panel says when a message didn't go through: the route's own words (its JSON `error`, or a stream error,
 * which carries the text the route chose), and otherwise that the message didn't go out. Never a raw error.
 */
export function chatErrorText(error: unknown): string {
  if (APICallError.isInstance(error)) {
    try {
      const body = JSON.parse(error.responseBody ?? "") as { error?: unknown };
      if (typeof body.error === "string" && body.error !== "") return body.error;
    } catch {
      // Not our JSON: a proxy's page, say.
    }
    return CHAT_UNAVAILABLE;
  }
  if (error instanceof Error && OURS.has(error.message)) return error.message;
  return CHAT_SEND_FAILED;
}

/** Whether "Probar de nuevo" makes sense: not once the member reached their cap. */
export function canRetry(text: string): boolean {
  return text !== CHAT_MEMBER_LIMIT;
}

/** "Te quedan 3 mensajes por hoy", from 5 down (spec, 9.2). */
export function remainingText(remaining: number | undefined): string | null {
  if (remaining === undefined || remaining > 5) return null;
  if (remaining === 0) return CHAT_MEMBER_LIMIT;
  return remaining === 1 ? "Te queda 1 mensaje por hoy." : `Te quedan ${remaining} mensajes por hoy.`;
}

/** The messages left today, as the newest answer that says it does. */
export function lastRemaining(messages: ChatUIMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const remaining = messages[i]!.metadata?.remaining;
    if (remaining !== undefined) return remaining;
  }
  return undefined;
}

/** An answer the model refused, with no words of its own: the panel says CHAT_REFUSED for it. */
export function isRefusal(message: ChatUIMessage): boolean {
  const finish = message.metadata?.finish;
  return (finish === "refusal" || finish === "content-filter") && !message.parts.some((part) => part.type === "text" && part.text !== "");
}

/**
 * The tool calls of cards still waiting for the member: the panel answers them "dismissed" before the next message.
 * Not the ones being confirmed right now (`confirming`): their expense is on its way, and the card answers for itself.
 */
export function pendingCards(messages: ChatUIMessage[], confirming: ReadonlySet<string> = new Set()): string[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "tool-proposeExpense" && part.state === "input-available" && !confirming.has(part.toolCallId) ? [part.toolCallId] : [],
    ),
  );
}

/** Whether "El agente está escribiendo…" shows: the question went out and no words of the answer are in yet. */
export function waitingForText(messages: ChatUIMessage[], status: string): boolean {
  if (status === "submitted") return true;
  if (status !== "streaming") return false;
  const last = messages.at(-1);
  return last?.role !== "assistant" || !last.parts.some((part) => part.type === "text" && part.text !== "");
}
