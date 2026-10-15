"use client";

import { type ReactNode, createContext, use } from "react";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { type Messages, messagesFor } from "./messages";

const Current = createContext<Locale>(DEFAULT_LOCALE);

/** The language the server picked for this page, for the components that run in the browser. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <Current value={locale}>{children}</Current>;
}

export function useLocale(): Locale {
  return use(Current);
}

export function useMessages(): Messages {
  return messagesFor(useLocale());
}
