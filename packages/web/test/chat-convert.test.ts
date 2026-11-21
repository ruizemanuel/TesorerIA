import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { type LanguageModel, readUIMessageStream, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { chatCall } from "../src/lib/chat/call";
import { badCardHint, toAnswerStream, toModelMessages } from "../src/lib/chat/convert";
import { readChatRequest } from "../src/lib/chat/request";
import { scriptedModel } from "../src/lib/chat/scripted-model";
import type { ChatUIMessage } from "../src/lib/chat/tools";
import { proposalPreview } from "../src/lib/chat/view";
import { COUNTRIES } from "../src/lib/countries";
import { type Messages, messagesFor } from "../src/lib/i18n/messages";
import { WARS } from "./support/fixtures";
import { es } from "./support/messages";

const usage = { inputTokens: { total: 2_000, noCache: 2_000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 0, reasoning: 30 } };
const streamOf = (chunks: LanguageModelV4StreamPart[]) => simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null });
const signed = { anthropic: { signature: "signed-thinking" } };
const card = JSON.stringify({ kind: "other", amount: "8.000", note: "Pelotas nuevas" });
/** What Anthropic, through the AI Gateway, puts first in every answer: its own record of the message, as a custom part. */
const messageStart: LanguageModelV4StreamPart = {
  type: "custom",
  kind: "anthropic.message_start",
  providerMetadata: { anthropic: { id: "msg_1", model: "claude-sonnet-5-5", usage: { input_tokens: 908, output_tokens: 24 } } },
};

/** An answer like Anthropic's with its thinking omitted: its record, a signed reasoning part with no text, then the card. */
const thinksThenProposes = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: streamOf([
        messageStart,
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
        messageStart,
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: text },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
      ]),
    }),
  });

let n = 0;
const user = (text: string): ChatUIMessage => ({ id: `u${++n}`, role: "user", parts: [{ type: "text", text }] });

/** One answer as the browser ends up holding it: the route's call and stream, read the way useChat reads them, in `m`. */
async function answerAs(model: LanguageModel, conversation: ChatUIMessage[], m: Messages = es): Promise<ChatUIMessage> {
  const call = chatCall({ model, brief: "<estado_del_fondo>…</estado_del_fondo>", locale: m.locale, country: m.country });
  const result = streamText({ ...call, messages: await toModelMessages(conversation, m.country) });
  let answer: ChatUIMessage | undefined;
  for await (const message of readUIMessageStream<ChatUIMessage>({ stream: toAnswerStream(result.stream, 7, m) })) answer = message;
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
    const checked = await readChatRequest(sent, es);
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

  it("keeps the provider's own record of an answer out of the panel, so any second question passes the route's check", async () => {
    const asked = user("¿Cuánto hay en el fondo?");
    const answer = await answerAs(answers("Hay $ 30.011,49 en el fondo."), [asked]);
    expect(answer.parts.map((part) => part.type)).toEqual(["step-start", "text"]);
    const sent: unknown = JSON.parse(JSON.stringify([asked, answer, user("¿Y cuánto debo?")]));
    expect((await readChatRequest(sent, es)).ok).toBe(true);
  });

  it("leaves out a card nobody answered, so the next call doesn't fail", async () => {
    const asked = user("Pagué $ 8.000 de pelotas nuevas");
    const answer = await answerAs(thinksThenProposes(), [asked]);
    const messages = await toModelMessages([asked, answer, user("¿Y?")], es.country);
    expect(JSON.stringify(messages)).not.toContain("tool-call");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
  });
});

/** A model that proposes a card with `amount`, and nothing else. */
const proposes = (amount: string) => {
  const input = JSON.stringify({ kind: "other", amount, note: "Pelotas" });
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: streamOf([
        { type: "tool-input-start", id: "call-1", toolName: "proposeExpense" },
        { type: "tool-input-delta", id: "call-1", delta: input },
        { type: "tool-input-end", id: "call-1" },
        { type: "tool-call", toolCallId: "call-1", toolName: "proposeExpense", input },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
      ]),
    }),
  });
};

describe("badCardHint: what the model reads when its card was wrong (spec, 12)", () => {
  it("hints the Mexican formats when a card is malformed", () => {
    expect(badCardHint(COUNTRIES.MX)).toContain("45,000 or 45,000.50");
    expect(badCardHint(COUNTRIES.AR)).toBe(
      "Invalid input: write the amount in pesos, like 45.000 or 45.000,50 in Spanish, 45,000 or 45,000.50 in English, above zero, and a note of up to 140 characters.",
    );
    expect(badCardHint(COUNTRIES.MX)).toBe("Invalid input: write the amount in pesos, like 45,000 or 45,000.50, above zero, and a note of up to 140 characters.");
  });

  it("goes to a Mexican fund's card the model wrote the Argentine way, and an Argentine one takes it", async () => {
    const mx = messagesFor("es", "MX");
    const wrong = await answerAs(proposes("5.000"), [user("Pagué $5,000 de pelotas")], mx);
    expect(wrong.parts.at(-1)).toMatchObject({ state: "output-error", errorText: badCardHint(COUNTRIES.MX) });
    const right = await answerAs(proposes("5,000"), [user("Pagué $5,000 de pelotas")], mx);
    expect(right.parts.at(-1)).toMatchObject({ type: "tool-proposeExpense", state: "input-available" });
    const argentine = await answerAs(proposes("5.000"), [user("Pagué $ 5.000 de pelotas")]);
    expect(argentine.parts.at(-1)).toMatchObject({ type: "tool-proposeExpense", state: "input-available" });
  });
});

describe("scriptedModel: the e2e's model, in the fund's country", () => {
  it("proposes $ 5.000 of new balls to an Argentine fund and $5,000 to a Mexican one, as each card reads them", async () => {
    const rules = { agreedExpense: "la cancha", leftThisWeek: 0n, votesRequired: 2, members: 3 };
    for (const [m, amount] of [
      [es, "5.000"],
      [messagesFor("es", "MX"), "5,000"],
    ] as const) {
      const answer = await answerAs(scriptedModel(m.country), [user("Pagué $ 5.000 de pelotas nuevas")], m);
      const card = answer.parts.find((part) => part.type === "tool-proposeExpense");
      expect(card, m.country.code).toMatchObject({ state: "input-available", input: { kind: "other", amount, note: "Pelotas nuevas" } });
      if (card?.type === "tool-proposeExpense" && card.state === "input-available") expect(proposalPreview(card.input, rules, m).amount).toBe(5_000n * WARS);
    }
  });
});
