import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The route's answers, in order: 202 when it ran, or 429 with Retry-After (absent when `retryAfter` is null). */
type Answer = { status: 202 } | { status: 429; retryAfter: string | null } | "network down";

let answers: Answer[];
const fetch = vi.fn(async (_path: string, _init: RequestInit) => {
  const answer = answers.shift() ?? { status: 202 };
  if (answer === "network down") throw new TypeError("Failed to fetch");
  const headers = answer.status === 429 && answer.retryAfter !== null ? { "retry-after": answer.retryAfter } : undefined;
  return answer.status === 202 ? Response.json({ ran: true }, { status: 202 }) : Response.json({ error: "El agente acaba de correr." }, { status: 429, headers });
});

/** A fresh copy of the module: the retry it keeps waiting is the page's, and each test is a page of its own. */
async function load() {
  vi.resetModules();
  return (await import("../src/lib/client/agent-run")).askAgentToRun;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
  answers = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("askAgentToRun: the run after a member's operation (spec, 8.3)", () => {
  it("asks the route once, and no more when the agent ran", async () => {
    const askAgentToRun = await load();
    answers = [{ status: 202 }];
    await askAgentToRun();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/api/agent/run");
    expect(init.method).toBe("POST");
  });

  it("asks once more when the minute another run took is over, and not before", async () => {
    const askAgentToRun = await load();
    answers = [{ status: 429, retryAfter: "38" }, { status: 202 }];
    await askAgentToRun();
    await vi.advanceTimersByTimeAsync(37_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("asks again only once: a second 429 means a run started after the operation, and that one covers it", async () => {
    const askAgentToRun = await load();
    answers = [{ status: 429, retryAfter: "38" }, { status: 429, retryAfter: "60" }];
    await askAgentToRun();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits one retry for every ask made meanwhile: one run does it all", async () => {
    const askAgentToRun = await load();
    answers = [
      { status: 429, retryAfter: "38" },
      { status: 429, retryAfter: "28" },
      { status: 202 },
    ];
    await askAgentToRun(); // a contribution
    await vi.advanceTimersByTimeAsync(10_000);
    await askAgentToRun(); // a vote, 10 s later
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("leaves it to the heartbeat when the 429 says no time it can use, or the network fails, and never throws", async () => {
    for (const answer of [
      { status: 429, retryAfter: null },
      { status: 429, retryAfter: "soon" },
      { status: 429, retryAfter: "0" },
      { status: 429, retryAfter: "7200" },
      "network down",
    ] as const) {
      const askAgentToRun = await load();
      fetch.mockClear();
      answers = [answer];
      await expect(askAgentToRun()).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
      expect(fetch, JSON.stringify(answer)).toHaveBeenCalledTimes(1);
    }
  });
});
