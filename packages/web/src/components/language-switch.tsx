"use client";

import { Fragment } from "react";
import { useLocale, useMessages } from "../lib/i18n/client";
import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_NAMES, type Locale } from "../lib/i18n/locales";
import { useRefresh } from "./refresh-provider";

/**
 * "ES · EN" (spec, 9.3): keeps the language in a cookie for a year and asks the server for the page again. The URL
 * stays, so an open panel stays open; inside a fund it refreshes through the fund's RefreshProvider.
 */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const m = useMessages();
  const { refresh } = useRefresh();
  const choose = (next: Locale) => {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    refresh();
  };
  return (
    <nav aria-label={m.language.label} className={`flex items-center text-sm ${className}`}>
      {LOCALES.map((option, i) => (
        <Fragment key={option}>
          {i > 0 && (
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
          )}
          <button
            type="button"
            lang={option}
            aria-label={LOCALE_NAMES[option]}
            aria-pressed={option === locale}
            onClick={() => choose(option)}
            className={`min-h-11 min-w-11 rounded-md px-2 ${option === locale ? "font-bold text-ink" : "text-muted hover:text-ink"}`}
          >
            {option.toUpperCase()}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
