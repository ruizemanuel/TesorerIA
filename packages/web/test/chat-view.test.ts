import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { CHAT_LONG_MESSAGE, CHAT_MEMBER_LIMIT, CHAT_SEND_FAILED, CHAT_UNAVAILABLE } from "../src/lib/chat/texts";
import type { ChatUIMessage } from "../src/lib/chat/tools";
import {
  canRetry,
  chatErrorText,
  isRefusal,
  isShownAnswer,
  lastRemaining,
  pendingCards,
  proposalPreview,
  remainingText,
  waitingForText,
} from "../src/lib/chat/view";
import { expenseOutcome } from "../src/lib/expense-outcome";
import { formatPesos } from "../src/lib/format";
import { WARS } from "./support/fixtures";

const rules = { agreedExpense: "la cancha", leftThisWeek: 15_000n * WARS, votesRequired: 3, members: 5 };
const apiError = (statusCode: number, responseBody: string) =>
  new APICallError({ message: responseBody, url: "/api/funds/x/chat", requestBodyValues: {}, statusCode, responseBody });
const answer = (parts: ChatUIMessage["parts"], metadata?: ChatUIMessage["metadata"]): ChatUIMessage => ({ id: "a", role: "assistant", parts, metadata });

describe("proposalPreview: what the card says before it's confirmed (spec, 9.2)", () => {
  it("says the agreed expense comes back if it fits in what's left of the week", () => {
    expect(proposalPreview({ kind: "agreed", amount: "45.000", note: "Jueves" }, rules)).toEqual({
      kind: "la cancha (el gasto acordado)",
      amount: 45_000n * WARS,
      note: "Jueves",
      next: `Si entra en lo que queda del tope de la semana (${formatPesos(15_000n * WARS)}), te lo devuelvo enseguida. Si no, se vota.`,
    });
  });

  it("says another expense goes to a vote, and has no amount it can't read", () => {
    expect(proposalPreview({ kind: "other", amount: "8.000", note: "" }, rules)).toMatchObject({ kind: "Otro gasto", next: "Se vota: necesita 3 de 5 votos." });
    expect(proposalPreview({ kind: "other", amount: "mucho", note: "" }, rules).amount).toBeNull();
  });
});

describe("chatErrorText: what the panel says when a message doesn't go through", () => {
  it("says what the route wrote", () => {
    expect(chatErrorText(apiError(429, JSON.stringify({ error: CHAT_MEMBER_LIMIT })))).toBe(CHAT_MEMBER_LIMIT);
    expect(chatErrorText(apiError(400, JSON.stringify({ error: CHAT_LONG_MESSAGE })))).toBe(CHAT_LONG_MESSAGE);
    expect(chatErrorText(apiError(502, "<html>Bad gateway</html>"))).toBe(CHAT_UNAVAILABLE);
  });

  it("says the stream's own error, and a lost connection in its own words, never a raw one", () => {
    expect(chatErrorText(new Error(CHAT_UNAVAILABLE))).toBe(CHAT_UNAVAILABLE);
    expect(chatErrorText(new TypeError("Failed to fetch"))).toBe(CHAT_SEND_FAILED);
  });

  it("offers to try again unless the member reached their cap", () => {
    expect(canRetry(CHAT_SEND_FAILED)).toBe(true);
    expect(canRetry(CHAT_MEMBER_LIMIT)).toBe(false);
  });
});

describe("the panel's small words", () => {
  it("says how many messages are left only from 5 down", () => {
    expect(remainingText(undefined)).toBeNull();
    expect(remainingText(6)).toBeNull();
    expect(remainingText(5)).toBe("Te quedan 5 mensajes por hoy.");
    expect(remainingText(1)).toBe("Te queda 1 mensaje por hoy.");
    expect(remainingText(0)).toBe(CHAT_MEMBER_LIMIT);
  });

  it("reads the messages left from the newest answer that says it", () => {
    expect(lastRemaining([answer([], { remaining: 7 }), answer([], { remaining: 6 }), answer([])])).toBe(6);
    expect(lastRemaining([])).toBeUndefined();
  });

  it("tells a refusal with no words apart", () => {
    expect(isRefusal(answer([], { finish: "refusal" }))).toBe(true);
    expect(isRefusal(answer([], { finish: "content-filter" }))).toBe(true);
    expect(isRefusal(answer([{ type: "text", text: "Hola" }], { finish: "content-filter" }))).toBe(false);
    expect(isRefusal(answer([], { finish: "stop" }))).toBe(false);
  });

  it("finds the cards still waiting for an answer", () => {
    const card = (toolCallId: string, state: "input-available" | "output-available") =>
      ({ type: "tool-proposeExpense", toolCallId, state, input: { kind: "other", amount: "5.000", note: "" }, ...(state === "output-available" ? { output: { status: "proposed" } } : {}) }) as ChatUIMessage["parts"][number];
    expect(pendingCards([answer([card("a", "output-available"), card("b", "input-available")])])).toEqual(["b"]);
  });

  it("leaves out the cards the member is confirming right now, so a new message doesn't dismiss them", () => {
    const card = (toolCallId: string) =>
      ({ type: "tool-proposeExpense", toolCallId, state: "input-available", input: { kind: "other", amount: "5.000", note: "" } }) as ChatUIMessage["parts"][number];
    const messages = [answer([card("b"), card("c")])];
    expect(pendingCards(messages, new Set(["b"]))).toEqual(["c"]);
    expect(pendingCards(messages, new Set(["b", "c"]))).toEqual([]);
    expect(pendingCards(messages, new Set())).toEqual(["b", "c"]);
  });

  it("shows an answer only once it has something to show: while the agent thinks, the typing row is its only avatar", () => {
    // What the route's first chunk makes: an answer with its metadata and nothing else.
    expect(isShownAnswer(answer([], { remaining: 7 }))).toBe(false);
    expect(isShownAnswer(answer([{ type: "step-start" }, { type: "reasoning", text: "", state: "done" }, { type: "text", text: "" }]))).toBe(false);
    expect(isShownAnswer(answer([{ type: "step-start" }, { type: "text", text: "Ho" }]))).toBe(true);
    expect(isShownAnswer(answer([], { finish: "refusal" }))).toBe(true);
  });

  it("counts a card once it says something: not while its input streams in, nor a call the panel doesn't show", () => {
    const input = { kind: "other", amount: "5.000", note: "" };
    const part = (state: string, extra: object = {}) => ({ type: "tool-proposeExpense", toolCallId: "c", state, input, ...extra }) as ChatUIMessage["parts"][number];
    expect(isShownAnswer(answer([part("input-streaming")]))).toBe(false);
    expect(isShownAnswer(answer([part("input-available")]))).toBe(true);
    expect(isShownAnswer(answer([part("output-available", { output: { status: "proposed" } })]))).toBe(true);
    expect(isShownAnswer(answer([part("output-error", { errorText: "Invalid input" })]))).toBe(true);
    const unknown = { type: "dynamic-tool", toolName: "proposeExpense", toolCallId: "d", state: "output-error", input: {}, errorText: "Invalid input" };
    expect(isShownAnswer(answer([unknown as ChatUIMessage["parts"][number]]))).toBe(false);
  });

  it("shows the agent typing until the answer's first words", () => {
    const asked: ChatUIMessage = { id: "u", role: "user", parts: [{ type: "text", text: "Hola" }] };
    expect(waitingForText([asked], "submitted")).toBe(true);
    expect(waitingForText([asked, answer([])], "streaming")).toBe(true);
    expect(waitingForText([asked, answer([{ type: "text", text: "Ho" }])], "streaming")).toBe(false);
    expect(waitingForText([asked, answer([{ type: "text", text: "Hola" }])], "ready")).toBe(false);
  });
});

describe("expenseOutcome: the same words in the Cargar gasto panel and the card", () => {
  it("says what happened to the expense, and falls back to the agent being busy", () => {
    expect(expenseOutcome("reimbursed")).toBe("Listo: el agente te devolvió la plata.");
    expect(expenseOutcome("proposed")).toBe("No entraba sin votación: el agente lo propuso y ahora lo vota el grupo.");
    expect(expenseOutcome("whatever")).toBe("El agente está ocupado: lo procesa en unos minutos.");
  });
});
