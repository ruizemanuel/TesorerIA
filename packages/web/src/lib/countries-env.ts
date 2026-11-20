import { type CountryCode, DEFAULT_COUNTRY, offeredCountries, requestCountry } from "./countries";
import { env } from "./env";

/**
 * The countries this deployment offers. Apart from countries.ts so that one never reads the environment and the browser
 * can import it.
 */
export function offeredNow(): CountryCode[] {
  return offeredCountries(env().EXTRA_COUNTRIES);
}

/** The header Vercel sends every request with: the visitor's country by their IP, as ISO 3166-1 alpha-2 ("AR", "MX"). */
export const IP_COUNTRY_HEADER = "x-vercel-ip-country";

/**
 * The country of a visitor outside any fund (spec, 6): their IP's (`ipCountry`, the header's value) if this deployment
 * offers it, else Argentina. Without the header, as on a local run or in the e2e, it's Argentina with nothing to check.
 */
export function visitorCountry(ipCountry: string | null): CountryCode {
  return ipCountry === null ? DEFAULT_COUNTRY : requestCountry(ipCountry, offeredNow());
}
