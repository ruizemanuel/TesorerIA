import { type UIMessage, safeValidateUIMessages } from "ai";
import type { Messages } from "../i18n/messages";
import { MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } from "./limits";
import { type ChatUIMessage, chatTools } from "./tools";

/** A message's text parts, together. */
export function messageText(message: UIMessage): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/**
 * What a message weighs against the history's cap. It fails closed: a plain text part weighs its text, and every
 * other part (a tool call with its input, output or error, reasoning, a text part that carries provider metadata)
 * weighs its whole JSON, because whatever the browser puts in a part is forwarded to the model.
 */
export function messageChars(message: UIMessage): number {
  let chars = 0;
  for (const part of message.parts) {
    chars += part.type === "text" && part.providerMetadata === undefined ? part.text.length : JSON.stringify(part).length;
  }
  return chars;
}

/**
 * The history the model gets (spec, 8.2): the last MAX_HISTORY_MESSAGES messages, the oldest dropped until the rest
 * fits in MAX_HISTORY_CHARS, starting with one of the member's. Whole messages go, so a tool call and its result,
 * which live in the same message, stay together.
 */
export function trimHistory<M extends UIMessage>(messages: readonly M[]): M[] {
  const kept = messages.slice(-MAX_HISTORY_MESSAGES);
  let total = kept.reduce((sum, message) => sum + messageChars(message), 0);
  while (kept.length > 1 && (total > MAX_HISTORY_CHARS || kept[0]!.role !== "user")) {
    total -= messageChars(kept.shift()!);
  }
  return kept;
}

/**
 * The parts a message may carry (spec, 8.2). The member's message is text and nothing else: no files, no metadata.
 * The agent's are what it makes: text, reasoning (Anthropic needs its signed thinking back along with a tool
 * result), step markers, and the one tool's card, which becomes a dynamic-tool part when its input was invalid.
 */
const ASSISTANT_PARTS = new Set<string>(["text", "reasoning", "step-start", "tool-proposeExpense", "dynamic-tool"]);

function hasOnlyAllowedParts(message: UIMessage): boolean {
  if (message.role === "user") return message.parts.every((part) => part.type === "text" && part.providerMetadata === undefined);
  return message.parts.every((part) => ASSISTANT_PARTS.has(part.type));
}

export type ChatRequest = { ok: true; messages: ChatUIMessage[] } | { ok: false; error: string };

/**
 * The conversation the browser sent, checked: a valid list of messages (tool parts against their schemas), no
 * system message, only the parts a message may carry, and the member's text last, up to MAX_MESSAGE_CHARS. Then it's
 * trimmed (trimHistory). What it refuses with is said in the request's language (`m`).
 */
export async function readChatRequest(messages: unknown, m: Messages): Promise<ChatRequest> {
  const validated = await safeValidateUIMessages<ChatUIMessage>({ messages, tools: chatTools });
  if (!validated.success) return { ok: false, error: m.chat.badRequest };
  const all = validated.data;
  if (all.some((message) => message.role === "system" || !hasOnlyAllowedParts(message))) return { ok: false, error: m.chat.badRequest };
  const last = all.at(-1);
  const text = last === undefined ? "" : messageText(last);
  if (last?.role !== "user" || text.trim() === "") return { ok: false, error: m.chat.badRequest };
  // The raw text is measured, not the trimmed one: the whole message reaches the model, padding included.
  if ([...text].length > MAX_MESSAGE_CHARS) return { ok: false, error: m.chat.longMessage(MAX_MESSAGE_CHARS) };
  return { ok: true, messages: trimHistory(all) };
}
