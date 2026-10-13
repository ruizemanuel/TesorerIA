import { type UIMessage, safeValidateUIMessages } from "ai";
import { MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } from "./limits";
import { CHAT_BAD_REQUEST, CHAT_LONG_MESSAGE } from "./texts";
import { type ChatUIMessage, chatTools } from "./tools";

/** A message's text parts, together. */
export function messageText(message: UIMessage): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/**
 * What a message weighs against the history's cap: its text, plus the inputs and outputs of its tool parts. Not its
 * reasoning, which is the model's own and comes back signed.
 */
export function messageChars(message: UIMessage): number {
  let chars = 0;
  for (const part of message.parts) {
    if (part.type === "text") chars += part.text.length;
    else if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const { input, output } = part as { input?: unknown; output?: unknown };
      chars += JSON.stringify([input ?? null, output ?? null]).length;
    }
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

export type ChatRequest = { ok: true; messages: ChatUIMessage[] } | { ok: false; error: string };

/**
 * The conversation the browser sent, checked: a valid list of messages (tool parts against their schemas), no
 * system message, and the member's text last, up to MAX_MESSAGE_CHARS. Then it's trimmed (trimHistory).
 */
export async function readChatRequest(messages: unknown): Promise<ChatRequest> {
  const validated = await safeValidateUIMessages<ChatUIMessage>({ messages, tools: chatTools });
  if (!validated.success) return { ok: false, error: CHAT_BAD_REQUEST };
  const all = validated.data;
  if (all.some((message) => message.role === "system")) return { ok: false, error: CHAT_BAD_REQUEST };
  const last = all.at(-1);
  const text = last === undefined ? "" : messageText(last).trim();
  if (last?.role !== "user" || text === "") return { ok: false, error: CHAT_BAD_REQUEST };
  if ([...text].length > MAX_MESSAGE_CHARS) return { ok: false, error: CHAT_LONG_MESSAGE };
  return { ok: true, messages: trimHistory(all) };
}
