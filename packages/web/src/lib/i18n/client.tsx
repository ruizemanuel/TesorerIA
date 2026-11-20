"use client";

import { type ReactNode, createContext, use } from "react";
import { type Country, type CountryCode, DEFAULT_COUNTRY } from "../countries";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { type Messages, messagesFor } from "./messages";

const Current = createContext<Messages>(messagesFor(DEFAULT_LOCALE, DEFAULT_COUNTRY));

/**
 * The language the server picked for this page and the country it speaks for, for the components that run in the
 * browser. One inside another wins over it: a fund's pages speak the fund's country.
 */
export function LocaleProvider({ locale, country, children }: { locale: Locale; country: CountryCode; children: ReactNode }) {
  return <Current value={messagesFor(locale, country)}>{children}</Current>;
}

export function useLocale(): Locale {
  return use(Current).locale;
}

export function useCountry(): Country {
  return use(Current).country;
}

export function useMessages(): Messages {
  return use(Current);
}
