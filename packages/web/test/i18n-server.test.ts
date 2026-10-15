import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ cookie: undefined as string | undefined, acceptLanguage: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "lang" && request.cookie !== undefined ? { name, value: request.cookie } : undefined) }),
  headers: async () => new Headers(request.acceptLanguage === null ? {} : { "accept-language": request.acceptLanguage }),
}));

const { getLocale, getMessages } = await import("../src/lib/i18n/server");
const { en } = await import("../src/lib/i18n/en");

beforeEach(() => {
  request.cookie = undefined;
  request.acceptLanguage = null;
});

describe("getLocale", () => {
  it("reads the page's language from its cookie, then from the browser", async () => {
    request.cookie = "en";
    expect(await getLocale()).toBe("en");
    request.cookie = undefined;
    request.acceptLanguage = "en-US,en;q=0.9";
    expect(await getLocale()).toBe("en");
    request.acceptLanguage = null;
    expect(await getLocale()).toBe("es");
  });

  it("hands over that language's dictionary", async () => {
    request.cookie = "en";
    expect(await getMessages()).toBe(en);
  });
});
