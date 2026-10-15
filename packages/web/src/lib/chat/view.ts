import { APICallError } from "ai";
import { formatPesos, parsePesosEitherWay } from "../format";
import { MESSAGES, type Messages } from "../i18n/messages";
import { MAX_MESSAGE_CHARS } from "./limits";
import type { ChatUIMessage, ProposedExpense } from "./tools";

/** What the card needs from the fund to say what will happen (spec, 9.2). */
export type ProposalRules = { agreedExpense: string; leftThisWeek: bigint; votesRequired: number; members: number };

/**
 * The card before it's confirmed: the kind, the amount (null if it can't be read), the note, and what comes next, in
 * the page's language. The amount is the model's, not a person's: it is read in either language's way (parsePesosEitherWay).
 */
export function proposalPreview(input: ProposedExpense, rules: ProposalRules, m: Messages) {
  const amount = parsePesosEitherWay(input.amount);
  return {
    kind: input.kind === "agreed" ? m.expense.agreed(rules.agreedExpense) : m.chat.card.otherExpense,
    amount,
    note: input.note,
    next:
      input.kind === "agreed"
        ? m.chat.card.agreedNext(formatPesos(rules.leftThisWeek, m.locale))
        : m.chat.card.otherNext(rules.votesRequired, rules.members),
  };
}

/** The route's own words, in every language: it answers in its request's, which isn't always the page's by the time they arrive. */
const OURS = new Set(
  Object.values(MESSAGES).flatMap((m) => [m.chat.unavailable, m.chat.memberLimit, m.chat.longMessage(MAX_MESSAGE_CHARS), m.chat.badRequest, m.chat.notFound]),
);
const MEMBER_LIMITS = new Set(Object.values(MESSAGES).map((m) => m.chat.memberLimit));

/**
 * What the panel says when a message didn't go through: the route's own words (its JSON `error`, or a stream error,
 * which carries the text the route chose), and otherwise that the message didn't go out. Never a raw error.
 */
export function chatErrorText(error: unknown, m: Messages): string {
  if (APICallError.isInstance(error)) {
    try {
      const body = JSON.parse(error.responseBody ?? "") as { error?: unknown };
      if (typeof body.error === "string" && body.error !== "") return body.error;
    } catch {
      // Not our JSON: a proxy's page, say.
    }
    return m.chat.unavailable;
  }
  if (error instanceof Error && OURS.has(error.message)) return error.message;
  return m.chat.sendFailed;
}

/** Whether "Probar de nuevo" makes sense: not once the member reached their cap (said in either language). */
export function canRetry(text: string): boolean {
  return !MEMBER_LIMITS.has(text);
}

/** "Te quedan 3 mensajes por hoy" ("You have 3 messages left today"), from 5 down (spec, 9.2). */
export function remainingText(remaining: number | undefined, m: Messages): string | null {
  if (remaining === undefined || remaining > 5) return null;
  if (remaining === 0) return m.chat.memberLimit;
  return m.chat.remaining(remaining);
}

/** The messages left today, as the newest answer that says it does. */
export function lastRemaining(messages: ChatUIMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const remaining = messages[i]!.metadata?.remaining;
    if (remaining !== undefined) return remaining;
  }
  return undefined;
}

/** An answer the model refused, with no words of its own: the panel says `chat.refused` for it. */
export function isRefusal(message: ChatUIMessage): boolean {
  const finish = message.metadata?.finish;
  return (finish === "refusal" || finish === "content-filter") && !message.parts.some((part) => part.type === "text" && part.text !== "");
}

/** The card's states that show something (ExpenseProposalCard): the card itself, its outcome, or `chat.badCard`. */
const SHOWN_CARD = new Set(["input-available", "output-available", "output-error"]);

/**
 * Whether the panel shows an answer: once it has words, a card that says something, or a refusal. The route's first
 * chunk makes an empty answer at once; until it has one of those, the typing row stands for it, with its own avatar.
 */
export function isShownAnswer(message: ChatUIMessage): boolean {
  return (
    isRefusal(message) ||
    message.parts.some((part) => (part.type === "text" && part.text !== "") || (part.type === "tool-proposeExpense" && SHOWN_CARD.has(part.state)))
  );
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
