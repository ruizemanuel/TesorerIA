import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { type LanguageModel, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

/** What the scripted model says to anything but an expense. */
export const SCRIPTED_ANSWER = "Soy el agente de prueba: en el fork no hay modelo.";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

function lastUserText(prompt: LanguageModelV4CallOptions["prompt"]): string {
  const asked = prompt.findLast((message) => message.role === "user");
  if (asked === undefined || typeof asked.content === "string") return "";
  return asked.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function script(prompt: LanguageModelV4CallOptions["prompt"]): LanguageModelV4StreamPart[] {
  if (/pagu[eé]/i.test(lastUserText(prompt))) {
    // A new id each time: the card uses it as the expense's client key.
    const id = `scripted-${Date.now()}`;
    const input = JSON.stringify({ kind: "other", amount: "5.000", note: "Pelotas nuevas" });
    return [
      { type: "tool-input-start", id, toolName: "proposeExpense" },
      { type: "tool-input-delta", id, delta: input },
      { type: "tool-input-end", id },
      { type: "tool-call", toolCallId: id, toolName: "proposeExpense", input },
      { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
    ];
  }
  return [
    { type: "text-start", id: "scripted-text" },
    { type: "text-delta", id: "scripted-text", delta: SCRIPTED_ANSWER },
    { type: "text-end", id: "scripted-text" },
    { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
  ];
}

/**
 * The end-to-end test's model (CHAT_MODEL=mock, on the fork only: env.ts): an expense the member says they paid
 * becomes a card for $ 5.000 of new balls, and anything else gets SCRIPTED_ANSWER. Loaded only then (model.ts).
 */
export function scriptedModel(): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async (options) => ({ stream: simulateReadableStream({ chunks: script(options.prompt), initialDelayInMs: 300, chunkDelayInMs: 20 }) }),
  });
}
