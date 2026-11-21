import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { type LanguageModel, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { Country } from "../countries";
import { WARS_UNIT, formatAmount } from "../format";

/** What the scripted model says to anything but an expense. */
export const SCRIPTED_ANSWER = "Soy el agente de prueba: en el fork no hay modelo.";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/**
 * How Anthropic, through the AI Gateway, starts every answer: with its own record of the message, a custom part that
 * must never reach the panel (toAnswerStream), or the member's next message would be refused.
 */
const messageStart: LanguageModelV4StreamPart = { type: "custom", kind: "anthropic.message_start", providerMetadata: { anthropic: { id: "scripted" } } };

function lastUserText(prompt: LanguageModelV4CallOptions["prompt"]): string {
  const asked = prompt.findLast((message) => message.role === "user");
  if (asked === undefined || typeof asked.content === "string") return "";
  return asked.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function script(prompt: LanguageModelV4CallOptions["prompt"], country: Country): LanguageModelV4StreamPart[] {
  if (/pagu[eé]/i.test(lastUserText(prompt))) {
    // A new id each time: the card uses it as the expense's client key.
    const id = `scripted-${Date.now()}`;
    // The amount as the fund's Spanish screen writes it, as the model would: "5.000" in Argentina, "5,000" in Mexico.
    const amount = formatAmount(5_000n * WARS_UNIT, { locale: "es", country });
    const input = JSON.stringify({ kind: "other", amount, note: "Pelotas nuevas" });
    return [
      messageStart,
      { type: "tool-input-start", id, toolName: "proposeExpense" },
      { type: "tool-input-delta", id, delta: input },
      { type: "tool-input-end", id },
      { type: "tool-call", toolCallId: id, toolName: "proposeExpense", input },
      { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
    ];
  }
  return [
    messageStart,
    { type: "text-start", id: "scripted-text" },
    { type: "text-delta", id: "scripted-text", delta: SCRIPTED_ANSWER },
    { type: "text-end", id: "scripted-text" },
    { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
  ];
}

/**
 * The end-to-end test's model (CHAT_MODEL=mock, on the fork only: env.ts), for a fund in `country`: an expense the
 * member says they paid becomes a card for 5.000 of the fund's pesos of new balls, and anything else gets
 * SCRIPTED_ANSWER. Loaded only then (model.ts).
 */
export function scriptedModel(country: Country): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async (options) => ({
      stream: simulateReadableStream({ chunks: script(options.prompt, country), initialDelayInMs: 300, chunkDelayInMs: 20 }),
    }),
  });
}
