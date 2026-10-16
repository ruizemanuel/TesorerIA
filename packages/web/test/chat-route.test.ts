import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { getAddress } from "viem";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_TAG } from "../src/lib/chat/brief";
import { chatInstructions } from "../src/lib/chat/instructions";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { chatMessages } from "../src/lib/db/schema";
import { buildFundView } from "../src/lib/fund-view";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import type { Messages } from "../src/lib/i18n/messages";
import type { FundScreen } from "../src/lib/read-fund";
import { addLiveFund, addUser, testDb } from "./support/db";
import { ANA, BETO, BLOCK, FUND, WARS, snapshot } from "./support/fixtures";

// The route as the server runs it: the session, the database, the fund's screen and the model stand in.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  db: null as unknown,
  enabled: true,
  model: null as unknown,
  screen: null as unknown,
  /** The language each read of the fund's screen was asked for. */
  screenLocales: [] as string[],
  memberLimit: 30,
  globalLimit: 150,
}));
vi.mock("../src/lib/current-user", () => ({ currentUser: async () => state.user }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/env", () => ({ env: () => ({ CHAT_MEMBER_DAILY_LIMIT: state.memberLimit, CHAT_DAILY_LIMIT: state.globalLimit }) }));
vi.mock("../src/lib/chat/model", () => ({
  chatEnabled: () => state.enabled,
  chatModel: async () => {
    if (state.model instanceof Error) throw state.model;
    return state.model;
  },
}));
vi.mock("../src/lib/read-fund", () => ({
  loadFundScreen: async (_address: string, _user: unknown, options: { locale: string }) => {
    state.screenLocales.push(options.locale);
    if (state.screen instanceof Error) throw state.screen;
    return state.screen;
  },
}));

const { POST } = await import("../src/app/api/funds/[address]/chat/route");

const usage = { inputTokens: { total: 2_000, noCache: 2_000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 40, reasoning: 0 } };
const streamOf = (chunks: LanguageModelV4StreamPart[]) => simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null });
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
const proposes = (input: string) =>
  new MockLanguageModelV4({
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

// A model call that has started and never ends: a step of the answer in flight, that a test can abort.
const hangsAfter = (text: string) =>
  ({
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "t2" });
        controller.enqueue({ type: "text-delta", id: "t2", delta: text });
      },
    }),
  }) as const;

/** The UI message chunks of a streamed answer, which arrives as server-sent events. */
const chunksOf = (body: string): Array<Record<string, unknown>> =>
  body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);

let db: Db;
let ana: CurrentUser;
let fundId: string;
let errors: MockInstance<typeof console.error>;
let n = 0;
const user = (text: string) => ({ id: `m${++n}`, role: "user", parts: [{ type: "text", text }] });
const agent = (text: string) => ({ id: `m${++n}`, role: "assistant", parts: [{ type: "text", text }] });
const chat = (messages: unknown[], address: string = FUND, init: RequestInit = {}) =>
  POST(
    new Request(`http://localhost:3000/api/funds/${address}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "chat", messages }),
      ...init,
    }),
    { params: Promise.resolve({ address }) },
  );

/** The request of a browser whose page is in English: its cookie says so (the chat answers in the request's language). */
const english: RequestInit = { headers: { "content-type": "application/json", cookie: "lang=en" } };

/** The fund's screen as the page of `m` shows it, without accents in what members wrote. */
function screenIn(m: Messages): FundScreen {
  const view = buildFundView({
    snapshot: snapshot(),
    name: m === es ? "Fútbol de los jueves" : "Thursday football",
    agreedExpense: m === es ? "la cancha" : "the pitch",
    balance: 90_000n * WARS,
    weeklyFee: 10_000n * WARS,
    joined: new Map(),
    names: new Map([[ANA, "Ana"]]),
    viewer: ANA,
    m,
  });
  return { fundId, block: BLOCK, view, timeline: [], viewerIsMember: true, publicView: false, contributionOnItsWay: false, cashOutOnItsWay: false, weekSummaries: [] };
}

afterEach(() => {
  errors.mockRestore();
});

beforeEach(async () => {
  // What the route logs is part of what it does (spec, 8.2: never the text), so a test reads it and nothing reaches the output.
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  db = await testDb();
  state.db = db;
  const anaRow = await addUser(db, "Ana", ANA);
  const beto = await addUser(db, "Beto", BETO);
  const fund = await addLiveFund(db, { creatorId: anaRow.id, address: FUND, members: [anaRow.id, beto.id] });
  ana = { id: anaRow.id, name: "Ana", account: getAddress(ANA) };
  state.user = ana;
  state.enabled = true;
  state.memberLimit = 30;
  state.globalLimit = 150;
  state.model = answers("Beto debe $ 10.000 de esta semana.");
  fundId = fund.id;
  state.screenLocales = [];
  state.screen = screenIn(es);
});

describe("POST /api/funds/:address/chat (spec, 8.2)", () => {
  it("answers 401 without a session, and 404 with the chat off, a bad address, or outside the fund", async () => {
    state.user = null;
    expect((await chat([user("Hola")])).status).toBe(401);
    state.user = ana;
    state.enabled = false;
    expect((await chat([user("Hola")])).status).toBe(404);
    state.enabled = true;
    expect((await chat([user("Hola")], "0x123")).status).toBe(404);
    state.screen = null;
    const outside = await chat([user("Hola")]);
    expect(outside.status).toBe(404);
    expect(await outside.json()).toEqual({ error: es.chat.notFound });
    expect(await db.select().from(chatMessages)).toEqual([]);
  });

  it("answers its errors in the request's language", async () => {
    state.user = null;
    const loggedOut = await chat([user("Hi")], FUND, english);
    expect(loggedOut.status).toBe(401);
    expect(await loggedOut.json()).toEqual({ error: "Log in with your passkey." });
    expect(await (await chat([user("Hola")])).json()).toEqual({ error: "Entrá con tu passkey." });
    state.user = ana;

    expect(await (await chat([user("Hi")], "0x123", english)).json()).toEqual({ error: "We couldn't find that fund." });
    expect(await (await chat([user("a".repeat(501))], FUND, english)).json()).toEqual({ error: "Your message can be up to 500 characters." });
    expect(await (await chat([user("Hi"), agent("Hi")], FUND, english)).json()).toEqual({ error: en.chat.badRequest });

    state.screen = null;
    expect(await (await chat([user("Hi")], FUND, english)).json()).toEqual({ error: en.chat.notFound });
    state.screen = new Error("forno is down");
    expect(await (await chat([user("Hi")], FUND, english)).json()).toEqual({ error: en.chat.unavailable });
    state.screen = screenIn(en);

    state.model = new Error("the scripted model could not load");
    expect(await (await chat([user("Hi")], FUND, english)).json()).toEqual({ error: en.chat.unavailable });
    state.model = answers("Beto owes ARS 10,000 for this week.");

    state.memberLimit = 1;
    await (await chat([user("Hi")], FUND, english)).text();
    const mine = await chat([user("Hi")], FUND, english);
    expect(mine.status).toBe(429);
    expect(await mine.json()).toEqual({ error: "We've talked enough for today. We'll pick this up tomorrow." });
    state.memberLimit = 30;
    state.globalLimit = 1;
    expect(await (await chat([user("Hi")], FUND, english)).json()).toEqual({ error: en.chat.unavailable });
  });

  it("refuses a body that's too big, a long message, and a conversation that doesn't end with the member, before counting", async () => {
    const huge = await chat([user("Hola")], FUND, { headers: { "content-type": "application/json", "content-length": "300000" } });
    expect(huge.status).toBe(413);
    const long = await chat([user("a".repeat(501))]);
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: es.chat.longMessage(500) });
    expect((await chat([user("Hola"), agent("Hola")])).status).toBe(400);
    expect(await db.select().from(chatMessages)).toEqual([]);
  });

  it("refuses a body that's too big even when it declares no length, as a chunked one doesn't", async () => {
    // Chunked: a stream body, so the request carries no content-length at all.
    const chunk = new TextEncoder().encode(JSON.stringify({ messages: [user("a".repeat(100_000))] }));
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request(`http://localhost:3000/api/funds/${FUND}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chunked,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const response = await POST(request, { params: Promise.resolve({ address: FUND }) });
    expect(response.status).toBe(413);

    // A whole body over the cap, with no length set by hand, is refused the same way.
    const whole = await chat([user("a".repeat(250_000))]);
    expect(whole.status).toBe(413);
    expect(await db.select().from(chatMessages)).toEqual([]);
  });

  it("answers 503 without counting the message when the fund can't be read", async () => {
    state.screen = new Error("forno is down");
    const response = await chat([user("Hola")]);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: es.chat.unavailable });
    expect(await db.select().from(chatMessages)).toEqual([]);
    expect(errors.mock.calls).toEqual([[`The chat could not read fund ${FUND}: forno is down`]]);
  });

  it("answers 503 without counting the message when the model can't be set up, and logs only what failed", async () => {
    state.model = new Error("the scripted model could not load for ana@example.com");
    const response = await chat([user("Hola")]);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: es.chat.unavailable });
    expect(await db.select().from(chatMessages)).toEqual([]);
    expect(errors.mock.calls).toEqual([[`The chat could not start for fund ${FUND}: Error`]]);
  });

  it("stops at the member's cap and at everyone's, saying which, and the model never hears of it", async () => {
    state.memberLimit = 1;
    const first = await chat([user("Hola")]);
    expect(first.status).toBe(200);
    await first.text(); // read to its end, so the model's one call is done
    const mine = await chat([user("Hola")]);
    expect(mine.status).toBe(429);
    expect(await mine.json()).toEqual({ error: es.chat.memberLimit });
    state.memberLimit = 30;
    state.globalLimit = 1;
    const everyone = await chat([user("Hola")]);
    expect(everyone.status).toBe(429);
    expect(await everyone.json()).toEqual({ error: es.chat.unavailable });
    expect((state.model as MockLanguageModelV4).doStreamCalls).toHaveLength(1);
  });

  it("streams the answer with the messages left, sends the instructions then the brief, and keeps the tokens", async () => {
    const response = await chat([user("¿Quién debe esta semana?")]);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Beto debe $ 10.000 de esta semana.");
    expect(body).toMatch(/"remaining":29/);

    expect(state.screenLocales).toEqual(["es"]);
    const [call] = (state.model as MockLanguageModelV4).doStreamCalls;
    expect(call!.prompt[0]).toMatchObject({ role: "system", content: chatInstructions("es") });
    expect(call!.prompt[1]).toMatchObject({ role: "system" });
    expect(JSON.stringify(call!.prompt[1])).toContain(`<${BRIEF_TAG}>`);
    expect(call!.tools?.map((t) => t.name)).toEqual(["proposeExpense"]);
    expect(call!.maxOutputTokens).toBe(1_000);
    expect(call!.providerOptions).toMatchObject({ anthropic: { effort: "low" } });

    await vi.waitFor(async () => {
      const [row] = await db.select().from(chatMessages);
      expect(row).toMatchObject({ userId: ana.id, inputTokens: 2_000, outputTokens: 40, finish: "stop" });
    });
    expect(errors).not.toHaveBeenCalled();
  });

  it("asks the model with the English instructions and the English brief when the page is in English", async () => {
    state.screen = screenIn(en);
    const response = await chat([user("Who owes this week?")], FUND, english);
    expect(response.status).toBe(200);
    await response.text();
    expect(state.screenLocales).toEqual(["en"]);
    const [call] = (state.model as MockLanguageModelV4).doStreamCalls;
    expect(call!.prompt[0]).toMatchObject({ role: "system", content: chatInstructions("en") });
    expect(call!.prompt[0]).toMatchObject({ content: expect.stringContaining("In plain English") });
    const brief = JSON.stringify(call!.prompt[1]);
    expect(brief).toContain(`<${BRIEF_TAG}>`);
    expect(brief).toContain("ARS");
    expect(brief).toContain("Fund: Thursday football.");
    expect(brief).not.toContain("Fondo:");
  });

  it("answers in English for a browser that asks for English and has no cookie, and in Spanish with neither", async () => {
    state.screen = screenIn(en);
    const asksEnglish = { headers: { "content-type": "application/json", "accept-language": "en-US,en;q=0.9" } };
    await (await chat([user("Hi")], FUND, asksEnglish)).text();
    state.screen = screenIn(es);
    await (await chat([user("Hola")])).text();
    expect(state.screenLocales).toEqual(["en", "es"]);
    const [englishCall, spanishCall] = (state.model as MockLanguageModelV4).doStreamCalls;
    expect(englishCall!.prompt[0]).toMatchObject({ content: chatInstructions("en") });
    expect(spanishCall!.prompt[0]).toMatchObject({ content: chatInstructions("es") });
    expect(JSON.stringify(spanishCall!.prompt[1])).toContain("Fondo: Fútbol de los jueves.");
  });

  it("keeps the history as it was when the page changes language mid-conversation, and answers the new message in the new language", async () => {
    state.screen = screenIn(en);
    const response = await chat([user("¿Quién debe esta semana?"), agent("Beto debe $ 10.000."), user("And now in English?")], FUND, english);
    expect(response.status).toBe(200);
    await response.text();
    const [call] = (state.model as MockLanguageModelV4).doStreamCalls;
    expect(call!.prompt[0]).toMatchObject({ content: chatInstructions("en") });
    const history = JSON.stringify(call!.prompt.slice(2));
    expect(history).toContain("¿Quién debe esta semana?");
    expect(history).toContain("Beto debe $ 10.000.");
    expect(history).toContain("And now in English?");
  });

  it("sends the model only the last messages", async () => {
    const history = [user("la primera"), ...Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? agent(`r${i}`) : user(`p${i}`)))];
    const response = await chat([...history, user("¿Y?")]);
    expect(response.status).toBe(200);
    await response.text(); // read to its end: the model is called after the response is returned, not before
    expect(JSON.stringify((state.model as MockLanguageModelV4).doStreamCalls[0]!.prompt)).not.toContain("la primera");
  });

  it("goes on when the member ignored a card and wrote something else", async () => {
    const ignored = {
      id: "card",
      role: "assistant",
      parts: [{ type: "tool-proposeExpense", toolCallId: "call-0", state: "input-available", input: { kind: "other", amount: "5.000", note: "Pelotas" } }],
    };
    const response = await chat([user("Pagué las pelotas"), ignored, user("No, dejá. ¿Quién debe?")]);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Beto debe $ 10.000 de esta semana.");
  });

  it("streams a card the model proposes, and marks one it got wrong as an error for the card", async () => {
    state.model = proposes(JSON.stringify({ kind: "other", amount: "5.000", note: "Pelotas nuevas" }));
    const good = await (await chat([user("Pagué $ 5.000 de pelotas nuevas")])).text();
    expect(good).toContain('"toolName":"proposeExpense"');
    expect(good).not.toMatch(/tool-(input|output)-error/);

    state.model = proposes(JSON.stringify({ kind: "other", amount: "mucho", note: "Pelotas" }));
    const bad = await (await chat([user("Pagué mucho de pelotas")])).text();
    expect(bad).toMatch(/tool-(input|output)-error/);
  });

  it("sends a card the model got wrong back to it as a fixed hint, which is no failure: nothing logged, the row ends as the model ended", async () => {
    state.model = proposes(JSON.stringify({ kind: "other", amount: "mucho", note: "Pelotas" }));
    const body = await (await chat([user("Pagué mucho de pelotas")])).text();
    const cardErrors = chunksOf(body).filter((chunk) => chunk.type === "tool-input-error" || chunk.type === "tool-output-error");
    expect(cardErrors.length).toBeGreaterThan(0);
    for (const chunk of cardErrors) {
      expect(chunk.errorText).toMatch(/^Invalid input: /);
      expect(chunk.errorText).not.toMatch(/mucho|Pelotas/);
    }
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/mucho|Pelotas/);
    expect(errors).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      const [row] = await db.select().from(chatMessages);
      expect(row?.finish).toBe("tool-calls");
      expect(row?.inputTokens).toBeGreaterThan(0);
    });
  });

  it("tells the member the agent can't answer when the model fails, logs what failed and not what it said, and ends the row as an error", async () => {
    state.model = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "credit balance too low for ana@example.com", url: "https://gateway.test/v1", requestBodyValues: {}, statusCode: 402 });
      },
    });
    const response = await chat([user("Hola")]);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(chunksOf(body).filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: es.chat.unavailable }]);
    await vi.waitFor(async () => {
      const [row] = await db.select().from(chatMessages);
      expect(row?.finish).toBe("error");
    });
    expect(errors.mock.calls).toEqual([[`The chat failed for fund ${FUND}: AI_APICallError 402`]]);
  });

  it("tells the member in English that the agent can't answer when the page is in English", async () => {
    state.screen = screenIn(en);
    state.model = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "credit balance too low", url: "https://gateway.test/v1", requestBodyValues: {}, statusCode: 402 });
      },
    });
    const body = await (await chat([user("Hi")], FUND, english)).text();
    expect(chunksOf(body).filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "The agent can't answer right now. Try again later." }]);
  });

  it("ends the row as an abort, with the tokens of the steps done, when the member leaves mid-answer", async () => {
    // A first step the member's session has paid for (a card the model got wrong), then a second that never ends.
    const step = proposes(JSON.stringify({ kind: "other", amount: "mucho", note: "Pelotas" }));
    state.model = new MockLanguageModelV4({ doStream: [await step.doStream({} as never), hangsAfter("Beto")] });
    const leaving = new AbortController();
    const response = await chat([user("Hola")], FUND, { signal: leaving.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    while (!seen.includes("Beto")) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
    }
    expect(seen).toContain("Beto");
    leaving.abort();
    await vi.waitFor(async () => {
      const [row] = await db.select().from(chatMessages);
      expect(row).toMatchObject({ finish: "abort", inputTokens: 2_000, outputTokens: 40 });
    });
    await reader.cancel().catch(() => {});
    expect(errors).not.toHaveBeenCalled();
  });
});
