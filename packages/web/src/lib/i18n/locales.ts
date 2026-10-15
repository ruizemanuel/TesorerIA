/** The languages the web speaks (spec, 9.3): Rioplatense Spanish, as it always did, and English. */
export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
/** The cookie that remembers the language someone picked with the switch. */
export const LOCALE_COOKIE = "lang";
/** A year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Each language's name in itself: what the switch reads out, whichever language the page is in. */
export const LOCALE_NAMES: Record<Locale, string> = { es: "Español", en: "English" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The languages in an Accept-Language header, best first: primary subtags, lowercased, without q=0 or "*". */
function preferred(acceptLanguage: string): string[] {
  return acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.split(";").map((piece) => piece.trim());
      const q = params.find((param) => param.startsWith("q="));
      const quality = q === undefined ? 1 : Number(q.slice(2));
      return { language: tag.toLowerCase().split("-")[0] ?? "", quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter(({ language, quality }) => language !== "" && language !== "*" && quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map(({ language }) => language);
}

/**
 * The language of a request (spec, 9.3): the cookie, if it names one we have; else the browser's first language that
 * we have; English for a browser that asks only for others (it's the global one); Spanish with no header at all.
 */
export function pickLocale({ cookie, acceptLanguage }: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(cookie)) return cookie;
  const languages = preferred(acceptLanguage ?? "");
  if (languages.length === 0) return DEFAULT_LOCALE;
  return languages.find(isLocale) ?? "en";
}

/** One cookie's value from a Cookie header, or undefined. */
function cookieValue(header: string, name: string): string | undefined {
  for (const pair of header.split(";")) {
    const [key, ...value] = pair.split("=");
    if (key?.trim() === name) return value.join("=").trim();
  }
  return undefined;
}

/** The language of an API request, from its own headers: what a route answers its errors in. */
export function localeOf(request: Request): Locale {
  return pickLocale({
    cookie: cookieValue(request.headers.get("cookie") ?? "", LOCALE_COOKIE),
    acceptLanguage: request.headers.get("accept-language"),
  });
}
