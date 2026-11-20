import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { CountryCode } from "../countries";
import { IP_COUNTRY_HEADER, visitorCountry } from "../countries-env";
import { type Locale, LOCALE_COOKIE, pickLocale } from "./locales";
import { type Messages, messagesFor } from "./messages";

/** The page's language (spec, 9.3): its cookie, or else the browser's. Read once per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  return pickLocale({ cookie: jar.get(LOCALE_COOKIE)?.value, acceptLanguage: list.get("accept-language") });
});

/**
 * The country of a page outside any fund (spec, 6): the IP's, if this deployment offers it, else Argentina. A fund's
 * pages speak the fund's instead (fundCountryOf). Read once per request.
 */
export const getPageCountry = cache(async (): Promise<CountryCode> => visitorCountry((await headers()).get(IP_COUNTRY_HEADER)));

/** The page's dictionary, for `country`: the page's own (getPageCountry) when it doesn't say. */
export async function getMessages(country?: CountryCode): Promise<Messages> {
  const [locale, spoken] = await Promise.all([getLocale(), country ?? getPageCountry()]);
  return messagesFor(locale, spoken);
}
