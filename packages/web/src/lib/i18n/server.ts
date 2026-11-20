import { cookies, headers } from "next/headers";
import { cache } from "react";
import { type CountryCode, DEFAULT_COUNTRY } from "../countries";
import { type Locale, LOCALE_COOKIE, pickLocale } from "./locales";
import { type Messages, messagesFor } from "./messages";

/** The page's language (spec, 9.3): its cookie, or else the browser's. Read once per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  return pickLocale({ cookie: jar.get(LOCALE_COOKIE)?.value, acceptLanguage: list.get("accept-language") });
});

/** The page's dictionary, for `country`: Argentina when the page doesn't say. */
export async function getMessages(country: CountryCode = DEFAULT_COUNTRY): Promise<Messages> {
  return messagesFor(await getLocale(), country);
}
