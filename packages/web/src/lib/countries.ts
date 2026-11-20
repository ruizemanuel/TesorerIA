import { CURRENCIES, type Currency, WARS, currencyOf } from "@tesoreria/agent";
import { type Address, isAddressEqual } from "viem";
import type { Locale } from "./i18n/locales";

/** The countries the web has a table for. Which ones it offers is another matter: see offeredCountries. */
export type CountryCode = "AR" | "MX";
export const COUNTRY_CODES: readonly CountryCode[] = ["AR", "MX"];
export const DEFAULT_COUNTRY: CountryCode = "AR";

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && (COUNTRY_CODES as readonly string[]).includes(value);
}

/**
 * How a language writes numbers in a country: an amount in its currency ("$ 87.500,50" in Argentina, "$87,500.50" in
 * Mexico), and a percentage, with the same decimal separator and, if `percentSpace`, a space that doesn't break before
 * the sign ("0,25 %" in Argentina, "0.25%" in Mexico, as Intl writes es-MX).
 */
export type MoneyStyle = { mark: string; space: boolean; thousands: "." | ","; decimal: "," | "."; percentSpace: boolean };

/** The words a screen says for a country, in one language. */
export type CountryWords = {
  /** The ISO code of the currency. */
  code: string;
  /** The currency's token. */
  token: string;
  /** What a bank account is called there. */
  bankAccount: string;
  /** What the country's clock is called. */
  timeName: string;
};

export type Country = {
  code: CountryCode;
  /** The agent's entry for the country's currency. */
  currency: Currency;
  /** Rioplatense Spanish (voseo), or the neutral one the rest of Latin America reads. */
  spanish: "rioplatense" | "neutral";
  timeZone: string;
  /** The tag `Intl` knows each language by in this country. */
  intl: Record<Locale, string>;
  /** The `lang` of a page. */
  htmlLang: Record<Locale, string>;
  /** The `og:locale` of a page. */
  ogLocale: Record<Locale, string>;
  money: Record<Locale, MoneyStyle>;
  words: Record<Locale, CountryWords>;
  /** Whether Ripio's app is where people buy and sell the token there. */
  ripioApp: boolean;
  /** What a new fund proposes for its weekly fee and weekly cap, in the token's units. */
  defaults: { weeklyFee: bigint; weeklyCap: bigint };
};

/** What every format receives: the language, and the country whose money and clock it speaks. */
export type Speech = { locale: Locale; country: Country };

const UNIT = 10n ** 18n;

/** The agent's entry for a token the table names, so a token missing from CURRENCIES fails when this file loads. */
function tabled(token: Address): Currency {
  const currency = currencyOf(token);
  if (currency === undefined) throw new Error(`The agent's currencies don't have ${token}`);
  return currency;
}

export const COUNTRIES: Record<CountryCode, Country> = {
  AR: {
    code: "AR",
    currency: tabled(WARS),
    spanish: "rioplatense",
    timeZone: "America/Argentina/Buenos_Aires",
    intl: { es: "es-AR", en: "en-US" },
    htmlLang: { es: "es-AR", en: "en" },
    ogLocale: { es: "es_AR", en: "en_US" },
    money: {
      es: { mark: "$", space: true, thousands: ".", decimal: ",", percentSpace: true },
      en: { mark: "ARS", space: true, thousands: ",", decimal: ".", percentSpace: false },
    },
    words: {
      es: { code: "ARS", token: "wARS", bankAccount: "CBU, CVU o alias", timeName: "hora de Argentina" },
      en: { code: "ARS", token: "wARS", bankAccount: "CBU, CVU or alias", timeName: "Argentina time" },
    },
    ripioApp: true,
    defaults: { weeklyFee: 10_000n * UNIT, weeklyCap: 60_000n * UNIT },
  },
  MX: {
    code: "MX",
    currency: tabled("0x337E7456B420bD3481e7FA61fA9850343d610d34"),
    spanish: "neutral",
    timeZone: "America/Mexico_City",
    intl: { es: "es-MX", en: "en-US" },
    htmlLang: { es: "es-MX", en: "en" },
    ogLocale: { es: "es_MX", en: "en_US" },
    money: {
      es: { mark: "$", space: false, thousands: ",", decimal: ".", percentSpace: false },
      en: { mark: "MXN", space: true, thousands: ",", decimal: ".", percentSpace: false },
    },
    words: {
      es: { code: "MXN", token: "wMXN", bankAccount: "CLABE", timeName: "hora de Ciudad de México" },
      en: { code: "MXN", token: "wMXN", bankAccount: "CLABE", timeName: "Mexico City time" },
    },
    ripioApp: false,
    defaults: { weeklyFee: 100n * UNIT, weeklyCap: 600n * UNIT },
  },
};

/** The country whose currency is `token`, whatever the address's case, or undefined for any other token. */
export function countryOfCurrency(token: Address): Country | undefined {
  return COUNTRY_CODES.map((code) => COUNTRIES[code]).find((country) => isAddressEqual(country.currency.token, token));
}

/**
 * The countries the web offers: those whose currency has `offered` in the agent's table, plus `extra` (a local run's
 * EXTRA_COUNTRIES), in COUNTRY_CODES's order and each once.
 */
export function offeredCountries(extra: readonly CountryCode[]): CountryCode[] {
  const offered = new Set(CURRENCIES.filter((currency) => currency.offered).map((currency) => currency.country));
  return COUNTRY_CODES.filter((code) => offered.has(code) || extra.includes(code));
}

/** The country of a request outside any fund: its IP's (Vercel's x-vercel-ip-country) if it's offered, else Argentina. */
export function requestCountry(ipCountry: string | null | undefined, offered: readonly CountryCode[]): CountryCode {
  const code = ipCountry?.toUpperCase();
  return isCountryCode(code) && offered.includes(code) ? code : DEFAULT_COUNTRY;
}
