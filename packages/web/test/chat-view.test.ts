import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_CHARS } from "../src/lib/chat/limits";
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
import { NBSP, formatPesos } from "../src/lib/format";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { WARS } from "./support/fixtures";

const rules = { agreedExpense: "la cancha", leftThisWeek: 15_000n * WARS, votesRequired: 3, members: 5 };
const apiError = (statusCode: number, responseBody: string) =>
  new APICallError({ message: responseBody, url: "/api/funds/x/chat", requestBodyValues: {}, statusCode, responseBody });
const answer = (parts: ChatUIMessage["parts"], metadata?: ChatUIMessage["metadata"]): ChatUIMessage => ({ id: "a", role: "assistant", parts, metadata });

describe("proposalPreview: what the card says before it's confirmed (spec, 9.2)", () => {
  it("says the agreed expense comes back if it fits in what's left of the week", () => {
    expect(proposalPreview({ kind: "agreed", amount: "45.000", note: "Jueves" }, rules, es)).toEqual({
      kind: "la cancha (el gasto acordado)",
      amount: 45_000n * WARS,
      note: "Jueves",
      next: `Si entra en lo que queda del tope de la semana (${formatPesos(15_000n * WARS, "es")}), te lo devuelvo enseguida. Si no, se vota.`,
    });
  });

  it("says another expense goes to a vote, and has no amount it can't read", () => {
    expect(proposalPreview({ kind: "other", amount: "8.000", note: "" }, rules, es)).toMatchObject({
      kind: "Otro gasto",
      next: "Se vota: necesita 3 de 5 votos.",
    });
    expect(proposalPreview({ kind: "other", amount: "mucho", note: "" }, rules, es).amount).toBeNull();
  });

  it("says it in English, with the amounts the English way", () => {
    expect(proposalPreview({ kind: "agreed", amount: "45,000", note: "Thursday" }, rules, en)).toEqual({
      kind: "“la cancha” (the agreed expense)",
      amount: 45_000n * WARS,
      note: "Thursday",
      next: `If it fits in what's left of the weekly cap (ARS${NBSP}15,000), I'll pay you back right away. If not, it goes to a vote.`,
    });
    expect(proposalPreview({ kind: "other", amount: "8,000", note: "balls" }, rules, en)).toMatchObject({
      kind: "Other expense",
      next: "It goes to a vote: it needs 3 of 5 votes.",
    });
    expect(proposalPreview({ kind: "other", amount: "8,000", note: "balls" }, rules, en).amount).toBe(8_000n * WARS);
  });

  it("reads the model's amount in either language's format, whatever language the page is in", () => {
    // The page can change language in the middle of a chat, or the model can write as it's used to.
    expect(proposalPreview({ kind: "other", amount: "8,000", note: "" }, rules, es).amount).toBe(8_000n * WARS);
    expect(proposalPreview({ kind: "other", amount: "8.000", note: "" }, rules, en).amount).toBe(8_000n * WARS);
    expect(proposalPreview({ kind: "other", amount: "8.000,50", note: "" }, rules, en).amount).toBe(8_000n * WARS + 50n * 10n ** 16n);
    expect(proposalPreview({ kind: "other", amount: "forty", note: "" }, rules, en).amount).toBeNull();
  });
});

describe("chatErrorText: what the panel says when a message doesn't go through", () => {
  it("says what the route wrote", () => {
    expect(chatErrorText(apiError(429, JSON.stringify({ error: es.chat.memberLimit })), es)).toBe("Por hoy ya hablamos bastante. Mañana seguimos.");
    expect(chatErrorText(apiError(400, JSON.stringify({ error: es.chat.longMessage(MAX_MESSAGE_CHARS) })), es)).toBe(
      "Tu mensaje puede tener hasta 500 letras.",
    );
    expect(chatErrorText(apiError(502, "<html>Bad gateway</html>"), es)).toBe("El agente no puede responder ahora. Probá más tarde.");
  });

  it("says the stream's own error, and a lost connection in its own words, never a raw one", () => {
    expect(chatErrorText(new Error(es.chat.unavailable), es)).toBe(es.chat.unavailable);
    expect(chatErrorText(new TypeError("Failed to fetch"), es)).toBe("No pudimos mandar tu mensaje.");
  });

  it("says the same in English: the route's words, the stream's own error, and a lost connection", () => {
    expect(chatErrorText(apiError(429, JSON.stringify({ error: en.chat.memberLimit })), en)).toBe(en.chat.memberLimit);
    expect(chatErrorText(apiError(400, JSON.stringify({ error: en.chat.longMessage(MAX_MESSAGE_CHARS) })), en)).toBe(
      "Your message can be up to 500 characters.",
    );
    expect(chatErrorText(apiError(502, "<html>Bad gateway</html>"), en)).toBe(en.chat.unavailable);
    expect(chatErrorText(new Error(en.chat.unavailable), en)).toBe(en.chat.unavailable);
    expect(chatErrorText(new Error("fetch failed"), en)).toBe(en.chat.sendFailed);
  });

  it("knows the route's words in either language, since the page's language can change after the request", () => {
    for (const ours of [es, en]) {
      const words = [ours.chat.unavailable, ours.chat.memberLimit, ours.chat.longMessage(MAX_MESSAGE_CHARS), ours.chat.badRequest, ours.chat.notFound];
      for (const text of words) {
        expect(chatErrorText(new Error(text), es), text).toBe(text);
        expect(chatErrorText(new Error(text), en), text).toBe(text);
      }
    }
    // Any other message, even one that looks technical, is never shown raw.
    expect(chatErrorText(new Error("connect ECONNREFUSED 10.0.0.1:5432"), en)).toBe(en.chat.sendFailed);
  });

  it("offers to try again unless the member reached their cap, in either language", () => {
    expect(canRetry(es.chat.sendFailed)).toBe(true);
    expect(canRetry(es.chat.memberLimit)).toBe(false);
    expect(canRetry(en.chat.sendFailed)).toBe(true);
    expect(canRetry(en.chat.memberLimit)).toBe(false);
    // Only the cap's words take it away, whichever language they came in.
    expect(canRetry(es.chat.unavailable)).toBe(true);
    expect(canRetry(en.chat.unavailable)).toBe(true);
  });
});

describe("the panel's small words", () => {
  it("says how many messages are left only from 5 down", () => {
    expect(remainingText(undefined, es)).toBeNull();
    expect(remainingText(6, es)).toBeNull();
    expect(remainingText(5, es)).toBe("Te quedan 5 mensajes por hoy.");
    expect(remainingText(1, es)).toBe("Te queda 1 mensaje por hoy.");
    expect(remainingText(0, es)).toBe("Por hoy ya hablamos bastante. Mañana seguimos.");
  });

  it("says how many are left in English too", () => {
    expect(remainingText(undefined, en)).toBeNull();
    expect(remainingText(6, en)).toBeNull();
    expect(remainingText(5, en)).toBe("You have 5 messages left today.");
    expect(remainingText(1, en)).toBe("You have 1 message left today.");
    expect(remainingText(0, en)).toBe(en.chat.memberLimit);
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
    expect(expenseOutcome("reimbursed", es)).toBe("Listo: el agente te devolvió la plata.");
    expect(expenseOutcome("proposed", es)).toBe("No entraba sin votación: el agente lo propuso y ahora lo vota el grupo.");
    expect(expenseOutcome("whatever", es)).toBe("El agente está ocupado: lo procesa en unos minutos.");
  });

  it("says it in English too, and an unknown status is the agent being busy there as well", () => {
    expect(expenseOutcome("reimbursed", en)).toBe("Done: the agent paid you back.");
    expect(expenseOutcome("proposed", en)).toBe("It couldn't go through without a vote: the agent proposed it and now the group votes on it.");
    expect(expenseOutcome("whatever", en)).toBe("The agent is busy: it'll process it in a few minutes.");
    expect(expenseOutcome("constructor", en)).toBe("The agent is busy: it'll process it in a few minutes."); // not an inherited property
  });
});
