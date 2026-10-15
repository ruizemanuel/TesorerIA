import { en } from "./en";
import { type Messages, es } from "./es";
import type { Locale } from "./locales";

export type { Messages };

/** Each language's dictionary. The browser gets both: about 10 KB compressed, and no wait when the language changes. */
export const MESSAGES: Record<Locale, Messages> = { es, en };

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}
