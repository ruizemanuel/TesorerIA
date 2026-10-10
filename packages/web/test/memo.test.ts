import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ttlMemo } from "../src/lib/memo";

/** A clock the test moves by hand. */
function fakeClock(start = 1_000_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => void (at += ms) };
}

/** A memo of its own for each test: the entries live on globalThis, under the memo's name. */
const fresh = <T>(ttlMs: number, load: (key: string) => Promise<T | null>, now: () => number) => ttlMemo(`test-${randomUUID()}`, ttlMs, load, now);

describe("ttlMemo", () => {
  it("shares one load among concurrent calls for the same key", async () => {
    const clock = fakeClock();
    let finish = (_value: string) => {};
    const load = vi.fn((key: string) => new Promise<string>((resolve) => (finish = (value) => resolve(`${key}:${value}`))));
    const memo = fresh(45_000, load, clock.now);

    const calls = [memo("a"), memo("a"), memo("a")];
    finish("read");
    expect(await Promise.all(calls)).toEqual(["a:read", "a:read", "a:read"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("doesn't load again within the TTL, and does once it ran out", async () => {
    const clock = fakeClock();
    let reads = 0;
    const load = vi.fn(async (key: string) => `${key}:${++reads}`);
    const memo = fresh(45_000, load, clock.now);

    expect(await memo("a")).toBe("a:1");
    clock.advance(44_999);
    expect(await memo("a")).toBe("a:1");
    expect(load).toHaveBeenCalledTimes(1);

    clock.advance(1);
    expect(await memo("a")).toBe("a:2");
    expect(load).toHaveBeenCalledTimes(2);
    expect(await memo("b")).toBe("b:3"); // another key is its own read
  });

  it("never keeps a failure or a null: the next call reads again", async () => {
    const clock = fakeClock();
    const load = vi
      .fn<(key: string) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("the node didn't answer"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("read");
    const memo = fresh(45_000, load, clock.now);

    await expect(memo("a")).rejects.toThrow("the node didn't answer");
    expect(await memo("a")).toBeNull();
    expect(await memo("a")).toBe("read");
    expect(await memo("a")).toBe("read");
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("keeps at most 32 keys, dropping the oldest first", async () => {
    const clock = fakeClock();
    const load = vi.fn(async (key: string) => key);
    const memo = fresh(45_000, load, clock.now);

    for (let i = 0; i < 33; i++) await memo(`key-${i}`);
    expect(load).toHaveBeenCalledTimes(33);
    await memo("key-32"); // the newest is still there
    expect(load).toHaveBeenCalledTimes(33);
    await memo("key-0"); // the oldest went to make room
    expect(load).toHaveBeenCalledTimes(34);
  });
});
