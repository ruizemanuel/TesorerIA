import { COUNTRIES, type Country, type CountryCode } from "../countries";
import { en } from "./en";
import { type Dictionary, es } from "./es";
import type { Locale } from "./locales";

export type { Dictionary };

/**
 * What a page says, and the country it says it for: its money, its clock and its words. It has `locale` and `country`,
 * so it is a Speech, and `m` goes as it is to the formats (formatMoney(x, m)).
 */
export type Messages = Dictionary & { country: Country };

/** Each language's dictionary. The browser gets both: about 10 KB compressed, and no wait when the language changes. */
export const DICTIONARIES: Record<Locale, Dictionary> = { es, en };

/** One object per language and country, so the same page's `m` is the same object every time it's asked for. */
const MESSAGES = new Map<string, Messages>();

export function messagesFor(locale: Locale, country: CountryCode): Messages {
  const key = `${locale}:${country}`;
  let messages = MESSAGES.get(key);
  if (messages === undefined) {
    messages = { ...DICTIONARIES[locale], country: COUNTRIES[country] };
    MESSAGES.set(key, messages);
  }
  return messages;
}
