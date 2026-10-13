import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { type LanguageModel, readUIMessageStream, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { chatCall } from "../src/lib/chat/call";
import { toAnswerStream, toModelMessages } from "../src/lib/chat/convert";
import { readChatRequest } from "../src/lib/chat/request";
import type { ChatUIMessage } from "../src/lib/chat/tools";

const usage = { inputTokens: { total: 2_000, noCache: 2_000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 0, reasoning: 30 } };
const streamOf = (chunks: LanguageModelV4StreamPart[]) => simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null });
const signed = { anthropic: { signature: "signed-thinking" } };
const card = JSON.stringify({ kind: "other", amount: "8.000", note: "Pelotas nuevas" });

/** An answer like Anthropic's with its thinking omitted: a signed reasoning part with no text, then the card. */
const thinksThenProposes = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: streamOf([
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-delta", id: "r1", delta: "", providerMetadata: signed },
        { type: "reasoning-end", id: "r1" },
        { type: "tool-input-start", id: "call-1", toolName: "proposeExpense" },
        { type: "tool-input-delta", id: "call-1", delta: card },
        { type: "tool-input-end", id: "call-1" },
        { type: "tool-call", toolCallId: "call-1", toolName: "proposeExpense", input: card },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
      ]),
    }),
  });
const answers = (text: string) =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: streamOf([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: text },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
      ]),
    }),
  });

let n = 0;
const user = (text: string): ChatUIMessage => ({ id: `u${++n}`, role: "user", parts: [{ type: "text", text }] });

/** One answer as the browser ends up holding it: the route's call and stream, read the way useChat reads them. */
async function answerAs(model: LanguageModel, conversation: ChatUIMessage[]): Promise<ChatUIMessage> {
  const result = streamText({ ...chatCall({ model, brief: "<estado_del_fondo>…</estado_del_fondo>" }), messages: await toModelMessages(conversation) });
  let answer: ChatUIMessage | undefined;
  for await (const message of readUIMessageStream<ChatUIMessage>({ stream: toAnswerStream(result.stream, 7) })) answer = message;
  return { ...answer!, id: `a${++n}` };
}

/** What the panel's addToolOutput does to a card the member left for another question (the AI SDK's Chat). */
function dismissed(message: ChatUIMessage): ChatUIMessage {
  return {
    ...message,
    parts: message.parts.map((part) =>
      part.type === "tool-proposeExpense" ? ({ ...part, state: "output-available", output: { status: "dismissed" }, errorText: undefined } as typeof part) : part,
    ),
  };
}

describe("the browser's round trip (spec, 8.2): an answer with signed thinking and a card, then the next question", () => {
  it("streams the answer as the panel shows it: its parts, and the messages left and how it ended", async () => {
    const answer = await answerAs(thinksThenProposes(), [user("Pagué $ 8.000 de pelotas nuevas")]);
    expect(answer.role).toBe("assistant");
    expect(answer.parts.map((part) => part.type)).toEqual(["step-start", "reasoning", "tool-proposeExpense"]);
    expect(answer.parts[1]).toMatchObject({ type: "reasoning", text: "", providerMetadata: signed });
    expect(answer.parts[2]).toMatchObject({ state: "input-available", input: JSON.parse(card) });
    expect(answer.metadata).toEqual({ remaining: 7, finish: "tool-calls" });
  });

  it("passes the route's check after the card is dismissed, and gives the model its signed thinking, the call and its result", async () => {
    const asked = user("Pagué $ 8.000 de pelotas nuevas");
    const answer = await answerAs(thinksThenProposes(), [asked]);
    const next = user("No, dejá. ¿Cuánto debo?");
    // As DefaultChatTransport sends it: JSON.
    const sent: unknown = JSON.parse(JSON.stringify([asked, dismissed(answer), next]));
    const checked = await readChatRequest(sent);
    if (!checked.ok) throw new Error(`refused: ${checked.error}`);

    const followUp = answers("Debés $ 10.000 de esta semana.");
    const reply = await answerAs(followUp, checked.messages);
    expect(reply.parts.filter((part) => part.type === "text")).toEqual([{ type: "text", text: "Debés $ 10.000 de esta semana.", state: "done" }]);

    const prompt = followUp.doStreamCalls[0]!.prompt.filter((message) => message.role !== "system");
    expect(prompt).toMatchObject([
      { role: "user", content: [{ type: "text", text: "Pagué $ 8.000 de pelotas nuevas" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: signed },
          { type: "tool-call", toolCallId: "call-1", toolName: "proposeExpense", input: JSON.parse(card) },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "proposeExpense", output: { type: "json", value: { status: "dismissed" } } }] },
      { role: "user", content: [{ type: "text", text: "No, dejá. ¿Cuánto debo?" }] },
    ]);
  });

  it("leaves out a card nobody answered, so the next call doesn't fail", async () => {
    const asked = user("Pagué $ 8.000 de pelotas nuevas");
    const answer = await answerAs(thinksThenProposes(), [asked]);
    const messages = await toModelMessages([asked, answer, user("¿Y?")]);
    expect(JSON.stringify(messages)).not.toContain("tool-call");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
  });
});
