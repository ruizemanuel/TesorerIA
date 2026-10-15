import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localeOf, pickLocale } from "../src/lib/i18n/locales";

describe("pickLocale", () => {
  it("takes the cookie first, when it names a language we have", () => {
    expect(pickLocale({ cookie: "en", acceptLanguage: "es-AR,es;q=0.9" })).toBe("en");
    expect(pickLocale({ cookie: "es", acceptLanguage: "en-US,en;q=0.9" })).toBe("es");
  });

  it("ignores a cookie that names no language we have", () => {
    expect(pickLocale({ cookie: "pt", acceptLanguage: "en-US" })).toBe("en");
    expect(pickLocale({ cookie: "", acceptLanguage: "es-AR" })).toBe("es");
    expect(pickLocale({ cookie: "EN", acceptLanguage: "es-AR" })).toBe("es");
  });

  it("otherwise takes the browser's first language that we have, by its quality", () => {
    expect(pickLocale({ acceptLanguage: "es-AR,es;q=0.9,en;q=0.8" })).toBe("es");
    expect(pickLocale({ acceptLanguage: "es-419" })).toBe("es");
    expect(pickLocale({ acceptLanguage: "en-US,en;q=0.9" })).toBe("en");
    expect(pickLocale({ acceptLanguage: "en-GB" })).toBe("en");
    expect(pickLocale({ acceptLanguage: "es;q=0.5, en;q=0.8" })).toBe("en");
    // Portuguese first, then Spanish: the first one we have wins.
    expect(pickLocale({ acceptLanguage: "pt-BR,pt;q=0.9,es;q=0.8" })).toBe("es");
  });

  it("goes in English for a browser that asks only for languages we don't have", () => {
    expect(pickLocale({ acceptLanguage: "pt-BR,pt;q=0.9" })).toBe("en");
    expect(pickLocale({ acceptLanguage: "fr-FR" })).toBe("en");
  });

  it("goes in Spanish with no header, an empty one, a wildcard, or nothing it can read", () => {
    expect(pickLocale({})).toBe(DEFAULT_LOCALE);
    expect(pickLocale({ acceptLanguage: null })).toBe("es");
    expect(pickLocale({ acceptLanguage: "" })).toBe("es");
    expect(pickLocale({ acceptLanguage: "*" })).toBe("es");
    expect(pickLocale({ acceptLanguage: "en;q=0" })).toBe("es");
    expect(pickLocale({ acceptLanguage: ";;,," })).toBe("es");
  });
});

describe("isLocale", () => {
  it("knows only the languages we have", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("localeOf", () => {
  const request = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { headers });

  it("reads the cookie among the others, and the browser's language without it", () => {
    expect(localeOf(request({ cookie: `tesoreria=abc; ${LOCALE_COOKIE}=en; other=1`, "accept-language": "es-AR" }))).toBe("en");
    expect(localeOf(request({ cookie: "tesoreria=abc", "accept-language": "en-US" }))).toBe("en");
    expect(localeOf(request({}))).toBe("es");
  });

  it("doesn't take a cookie whose name only ends like ours", () => {
    expect(localeOf(request({ cookie: "xlang=en", "accept-language": "es-AR" }))).toBe("es");
  });
});
