import { COUNTRIES, type Country, type CountryCode } from "../countries";
import { en } from "./en";
import { type Dictionary, es } from "./es";
import type { Locale } from "./locales";
import { neutral } from "./neutral";

export type { Dictionary };

/**
 * What a page says, and the country it says it for: its money, its clock and its words. It has `locale` and `country`,
 * so it is a Speech, and `m` goes as it is to the formats (formatMoney(x, m)).
 */
export type Messages = Dictionary & { country: Country };

/** Each language's dictionary, its Spanish the Rioplatense one: a country that reads the neutral one gets it instead (dictionaryOf). */
export const DICTIONARIES: Record<Locale, Dictionary> = { es, en };

/**
 * Every dictionary a page may speak: the Rioplatense, the neutral and the English. The browser gets them all, about
 * 15 KB compressed, and no wait when the language changes.
 */
export const ALL_DICTIONARIES: readonly Dictionary[] = [es, neutral, en];

/** The dictionary of a language in a country: Spanish is the country's own (Country.spanish). */
function dictionaryOf(locale: Locale, country: Country): Dictionary {
  return locale === "es" && country.spanish === "neutral" ? neutral : DICTIONARIES[locale];
}

/** One object per language and country, so the same page's `m` is the same object every time it's asked for. */
const MESSAGES = new Map<string, Messages>();

export function messagesFor(locale: Locale, country: CountryCode): Messages {
  const key = `${locale}:${country}`;
  let messages = MESSAGES.get(key);
  if (messages === undefined) {
    messages = { ...dictionaryOf(locale, COUNTRIES[country]), country: COUNTRIES[country] };
    MESSAGES.set(key, messages);
  }
  return messages;
}
