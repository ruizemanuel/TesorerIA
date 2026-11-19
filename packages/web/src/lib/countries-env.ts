import { type CountryCode, offeredCountries } from "./countries";
import { env } from "./env";

/**
 * The countries this deployment offers. Apart from countries.ts so that one never reads the environment and the browser
 * can import it.
 */
export function offeredNow(): CountryCode[] {
  return offeredCountries(env().EXTRA_COUNTRIES);
}
