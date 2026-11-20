import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  acceptLanguage: null as string | null,
  /** The page's other headers, as mockHeaders sets them. */
  headers: {} as Record<string, string>,
  /** The server's variables beyond the ones every run has, as mockEnv sets them. */
  env: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "lang" && request.cookie !== undefined ? { name, value: request.cookie } : undefined) }),
  headers: async () => new Headers({ ...(request.acceptLanguage === null ? {} : { "accept-language": request.acceptLanguage }), ...request.headers }),
}));
// The server's settings as it reads them from its variables: EXTRA_COUNTRIES goes through the real parser.
vi.mock("../src/lib/env", async (importOriginal) => {
  const { parseEnv } = await importOriginal<typeof import("../src/lib/env")>();
  const base = { CHAIN_MODE: "fork", RP_ID: "localhost", ORIGIN: "http://localhost:3000", SESSION_SECRET: "s".repeat(32) };
  return { parseEnv, env: () => parseEnv({ ...base, ...request.env }) };
});

const { getLocale, getMessages, getPageCountry } = await import("../src/lib/i18n/server");
const { messagesOf, requestCountryOf } = await import("../src/lib/i18n/request");
const { messagesFor } = await import("../src/lib/i18n/messages");
const { en } = await import("../src/lib/i18n/en");
const { COUNTRIES } = await import("../src/lib/countries");

const mockHeaders = (headers: Record<string, string>) => {
  request.headers = headers;
};
const mockEnv = (env: Record<string, string>) => {
  request.env = env;
};
const apiRequest = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });

beforeEach(() => {
  request.cookie = undefined;
  request.acceptLanguage = null;
  mockHeaders({});
  mockEnv({});
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

  it("hands over that language's dictionary, for Argentina when the page names no country", async () => {
    request.cookie = "en";
    expect(await getMessages()).toEqual({ ...en, country: COUNTRIES.AR });
    expect((await getMessages("MX")).country).toBe(COUNTRIES.MX);
  });
});

describe("the country of a page outside any fund (spec, 6)", () => {
  it("takes the IP's country only when it's offered", async () => {
    mockHeaders({ "x-vercel-ip-country": "MX" });
    mockEnv({ EXTRA_COUNTRIES: "MX" });
    expect(await getPageCountry()).toBe("MX");
    mockHeaders({ "x-vercel-ip-country": "MX" });
    mockEnv({});
    expect(await getPageCountry()).toBe("AR");
    mockHeaders({});
    mockEnv({ EXTRA_COUNTRIES: "MX" });
    expect(await getPageCountry()).toBe("AR");
  });

  it("speaks the IP's country when the page names none, and the one it names when it does", async () => {
    mockHeaders({ "x-vercel-ip-country": "MX" });
    mockEnv({ EXTRA_COUNTRIES: "MX" });
    expect(await getMessages()).toBe(messagesFor("es", "MX"));
    expect(await getMessages("AR")).toBe(messagesFor("es", "AR"));
    request.cookie = "en";
    expect(await getMessages()).toBe(messagesFor("en", "MX"));
  });

  it("gives Argentina to a country without a table or not offered, as production does today", async () => {
    mockEnv({ EXTRA_COUNTRIES: "MX" });
    for (const ip of ["BR", "US", "", "XX"]) {
      mockHeaders({ "x-vercel-ip-country": ip });
      expect(await getPageCountry(), ip).toBe("AR");
    }
  });
});

describe("the country of an API request (spec, 6)", () => {
  it("takes the IP's country only when it's offered", () => {
    mockEnv({ EXTRA_COUNTRIES: "MX" });
    expect(requestCountryOf(apiRequest({ "x-vercel-ip-country": "MX" }))).toBe("MX");
    expect(requestCountryOf(apiRequest({}))).toBe("AR");
    expect(requestCountryOf(apiRequest({ "x-vercel-ip-country": "BR" }))).toBe("AR");
    mockEnv({});
    expect(requestCountryOf(apiRequest({ "x-vercel-ip-country": "MX" }))).toBe("AR");
  });

  it("answers in the request's language, for the country it's given or else the IP's", () => {
    mockEnv({ EXTRA_COUNTRIES: "MX" });
    const mexican = apiRequest({ "x-vercel-ip-country": "MX" });
    expect(messagesOf(mexican)).toBe(messagesFor("es", "MX"));
    expect(messagesOf(mexican, "AR")).toBe(messagesFor("es", "AR"));
    expect(messagesOf(apiRequest({ "x-vercel-ip-country": "MX", cookie: "lang=en" }))).toBe(messagesFor("en", "MX"));
    expect(messagesOf(apiRequest({}), "MX")).toBe(messagesFor("es", "MX"));
    expect(messagesOf(apiRequest({ "accept-language": "en-US" }))).toBe(messagesFor("en", "AR"));
  });
});
