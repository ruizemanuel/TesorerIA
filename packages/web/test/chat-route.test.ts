import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_TAG } from "../src/lib/chat/brief";
import { CHAT_INSTRUCTIONS } from "../src/lib/chat/instructions";
import { CHAT_LONG_MESSAGE, CHAT_MEMBER_LIMIT, CHAT_NOT_FOUND, CHAT_UNAVAILABLE } from "../src/lib/chat/texts";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { chatMessages } from "../src/lib/db/schema";
import { buildFundView } from "../src/lib/fund-view";
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
  memberLimit: 30,
  globalLimit: 150,
}));
vi.mock("../src/lib/current-user", () => ({ currentUser: async () => state.user }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/env", () => ({ env: () => ({ CHAT_MEMBER_DAILY_LIMIT: state.memberLimit, CHAT_DAILY_LIMIT: state.globalLimit }) }));
vi.mock("../src/lib/chat/model", () => ({ chatEnabled: () => state.enabled, chatModel: async () => state.model }));
vi.mock("../src/lib/read-fund", () => ({
  loadFundScreen: async () => {
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

let db: Db;
let ana: CurrentUser;
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

beforeEach(async () => {
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
  const view = buildFundView({
    snapshot: snapshot(),
    name: "Fútbol de los jueves",
    agreedExpense: "la cancha",
    balance: 90_000n * WARS,
    weeklyFee: 10_000n * WARS,
    joined: new Map(),
    names: new Map([[ANA, "Ana"]]),
    viewer: ANA,
  });
  state.screen = { fundId: fund.id, block: BLOCK, view, timeline: [], viewerIsMember: true, publicView: false, contributionOnItsWay: false } satisfies FundScreen;
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
    expect(await outside.json()).toEqual({ error: CHAT_NOT_FOUND });
    expect(await db.select().from(chatMessages)).toEqual([]);
  });

  it("refuses a body that's too big, a long message, and a conversation that doesn't end with the member, before counting", async () => {
    const huge = await chat([user("Hola")], FUND, { headers: { "content-type": "application/json", "content-length": "300000" } });
    expect(huge.status).toBe(413);
    const long = await chat([user("a".repeat(501))]);
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: CHAT_LONG_MESSAGE });
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
    expect(await response.json()).toEqual({ error: CHAT_UNAVAILABLE });
    expect(await db.select().from(chatMessages)).toEqual([]);
  });

  it("stops at the member's cap and at everyone's, saying which, and the model never hears of it", async () => {
    state.memberLimit = 1;
    const first = await chat([user("Hola")]);
    expect(first.status).toBe(200);
    await first.text(); // read to its end, so the model's one call is done
    const mine = await chat([user("Hola")]);
    expect(mine.status).toBe(429);
    expect(await mine.json()).toEqual({ error: CHAT_MEMBER_LIMIT });
    state.memberLimit = 30;
    state.globalLimit = 1;
    const everyone = await chat([user("Hola")]);
    expect(everyone.status).toBe(429);
    expect(await everyone.json()).toEqual({ error: CHAT_UNAVAILABLE });
    expect((state.model as MockLanguageModelV4).doStreamCalls).toHaveLength(1);
  });

  it("streams the answer with the messages left, sends the instructions then the brief, and keeps the tokens", async () => {
    const response = await chat([user("¿Quién debe esta semana?")]);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Beto debe $ 10.000 de esta semana.");
    expect(body).toMatch(/"remaining":29/);

    const [call] = (state.model as MockLanguageModelV4).doStreamCalls;
    expect(call!.prompt[0]).toMatchObject({ role: "system", content: CHAT_INSTRUCTIONS });
    expect(call!.prompt[1]).toMatchObject({ role: "system" });
    expect(JSON.stringify(call!.prompt[1])).toContain(`<${BRIEF_TAG}>`);
    expect(call!.tools?.map((t) => t.name)).toEqual(["proposeExpense"]);
    expect(call!.maxOutputTokens).toBe(1_000);
    expect(call!.providerOptions).toMatchObject({ anthropic: { effort: "low" } });

    await vi.waitFor(async () => {
      const [row] = await db.select().from(chatMessages);
      expect(row).toMatchObject({ userId: ana.id, inputTokens: 2_000, outputTokens: 40, finish: "stop" });
    });
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
});
