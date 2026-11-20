import type { CountryCode } from "../countries";
import { IP_COUNTRY_HEADER, visitorCountry } from "../countries-env";
import { localeOf } from "./locales";
import { type Messages, messagesFor } from "./messages";

/** The country of an API request outside any fund (spec, 6): its IP's, if it's offered, else Argentina. */
export function requestCountryOf(request: Request): CountryCode {
  return visitorCountry(request.headers.get(IP_COUNTRY_HEADER));
}

/**
 * What a route answers in: the request's language (`localeOf`), for `country`. A route that knows its fund passes the
 * fund's; one that doesn't, or doesn't yet, gets the request's (requestCountryOf).
 */
export function messagesOf(request: Request, country?: CountryCode): Messages {
  return messagesFor(localeOf(request), country ?? requestCountryOf(request));
}
