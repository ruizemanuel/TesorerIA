import type { Locale } from "./i18n/locales";

/** A space that never breaks a line: "$ 87.500" stays in one piece (spec, 9.1). */
export const NBSP = "\u00A0";
export const WARS_UNIT = 10n ** 18n;
export const USDT_UNIT = 10n ** 6n;
/** The most any amount typed in the app may be, $ 1.000.000.000.000: beyond anything real, far below uint256. */
export const MAX_PESOS = 1_000_000_000_000n * WARS_UNIT;
const CENT = 10n ** 16n;
/** Less than half a cent of wARS: it shows as nothing (heldAmounts), and there's nothing in it to pass to pesos. */
export const WARS_SPECK = CENT / 2n;
/** Less than half a cent of USDT, which shows as nothing too. */
export const USDT_SPECK = 5_000n;
export const TIME_ZONE = "America/Argentina/Buenos_Aires";

/** How each language writes amounts and dates (spec, 9.3). The time is Buenos Aires's in both: the fund's. */
const STYLE: Record<Locale, { intl: string; thousands: string; decimal: string; pesos: string; today: string; yesterday: string }> = {
  es: { intl: "es-AR", thousands: ".", decimal: ",", pesos: "$", today: "Hoy", yesterday: "Ayer" },
  en: { intl: "en-US", thousands: ",", decimal: ".", pesos: "ARS", today: "Today", yesterday: "Yesterday" },
};

/** The tag `Intl` knows each language by: what writes a date in words ("jueves, 15 de octubre", "Thursday, October 15"). */
export function intlLocale(locale: Locale): string {
  return STYLE[locale].intl;
}

function thousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * Pesos from wARS units: "$ 87.500" or "$ 16.050,37" in Spanish, "ARS 87,500" or "ARS 16,050.37" in English, rounded
 * half up (spec, 9.1 and 9.3). In English "$" would read as dollars.
 */
export function formatPesos(units: bigint, locale: Locale): string {
  const style = STYLE[locale];
  const negative = units < 0n;
  const cents = ((negative ? -units : units) + CENT / 2n) / CENT;
  const rest = cents % 100n;
  const whole = thousands((cents / 100n).toString(), style.thousands);
  const text = `${style.pesos}${NBSP}${whole}${rest === 0n ? "" : `${style.decimal}${rest.toString().padStart(2, "0")}`}`;
  return negative ? `-${text}` : text;
}

/** USDT from its 6-decimal units: "10 USDT", "10,5 USDT" ("10.5 USDT" in English). */
export function formatUsdt(units: bigint, locale: Locale): string {
  const style = STYLE[locale];
  const cents = (units + 5_000n) / 10_000n;
  const rest = cents % 100n;
  const decimals = rest === 0n ? "" : `${style.decimal}${rest.toString().padStart(2, "0").replace(/0$/, "")}`;
  return `${thousands((cents / 100n).toString(), style.thousands)}${decimals}${NBSP}USDT`;
}

/**
 * What a member's own account holds, as the inicio says it ("En tu cuenta tenés …"): pesos, then USDT, leaving out
 * what rounds to zero, since a speck of either says nothing.
 */
export function heldAmounts({ wars, usdt }: { wars: bigint; usdt: bigint }, locale: Locale): string[] {
  const amounts: string[] = [];
  if (wars >= WARS_SPECK) amounts.push(formatPesos(wars, locale));
  if (usdt >= USDT_SPECK) amounts.push(formatUsdt(usdt, locale));
  return amounts;
}

/** What an amount looks like in each language: thousands in groups of three, then up to two decimals. */
const AMOUNT: Record<Locale, { prefix: RegExp; shape: RegExp }> = {
  es: { prefix: /^\$/, shape: /^([1-9]\d{0,2}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/ },
  en: { prefix: /^ARS/i, shape: /^([1-9]\d{0,2}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/ },
};

/**
 * An amount typed in pesos, as wARS units, or null. Each language has its own way: in Spanish dots for thousands and
 * a comma for up to two decimals ("10.000,50"); in English the other way around ("10,000.50"). A separator that
 * can't be what the language says it is ("10.5" in Spanish, "10.000" in English) is refused instead of guessed, and
 * so is a group that starts with a zero, and anything that isn't more than zero. The screen's own prefix ("$" or
 * "ARS") may come along, so an amount copied out of the app reads back.
 */
export function parsePesos(input: string, locale: Locale): bigint | null {
  const { prefix, shape } = AMOUNT[locale];
  // `\s` takes the no-break space too, so "$ 45.000" copied out of the app's own screens reads back.
  const text = input.replace(/\s/g, "").replace(prefix, "");
  const match = shape.exec(text);
  if (match === null) return null;
  const whole = (match[1] ?? "").replace(/\D/g, "");
  const decimals = (match[2] ?? "").padEnd(2, "0");
  const units = BigInt(whole) * WARS_UNIT + BigInt(decimals) * CENT;
  return units > 0n ? units : null;
}

/**
 * An amount the chat's model wrote, in either language's way. The model writes as the page does, but a page can change
 * language mid-conversation. No text reads as two different amounts (format.test.ts), so trying both is safe; a
 * person's typing is read only in their page's language (parsePesos).
 */
export function parsePesosEitherWay(text: string): bigint | null {
  return parsePesos(text, "es") ?? parsePesos(text, "en");
}

/** An amount typed in USDT, as USDT units, or null: written like pesos in that language (parsePesos), to the cent, with or without "USDT". */
export function parseUsdt(input: string, locale: Locale): bigint | null {
  const asPesos = parsePesos(input.replace(/\s*USDT\s*$/i, ""), locale);
  return asPesos === null ? null : asPesos / 10n ** 12n;
}

function parts(date: Date, options: Intl.DateTimeFormatOptions, intl = "es-AR"): Record<string, string> {
  const formatted = new Intl.DateTimeFormat(intl, { timeZone: TIME_ZONE, ...options }).formatToParts(date);
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

function dayNumber(date: Date): number {
  const { year, month, day } = parts(date, { year: "numeric", month: "numeric", day: "numeric" });
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000;
}

/**
 * "Hoy, 10:15", "Ayer, 18:02", "Lunes, 9:00" within the last week, then "12/10" (spec, 9.2); in English "Today, 10:15",
 * "Yesterday, 18:02", "Monday, 9:00", then "Oct 12", since "12/10" reads differently in England and in the US (9.3).
 * Always on a 24-hour clock, in Buenos Aires time.
 */
export function formatWhen(date: Date, now: Date, locale: Locale): string {
  const style = STYLE[locale];
  const { hour, minute } = parts(date, { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const time = `${Number(hour)}:${minute}`;
  const daysAgo = dayNumber(now) - dayNumber(date);
  if (daysAgo === 0) return `${style.today}, ${time}`;
  if (daysAgo === 1) return `${style.yesterday}, ${time}`;
  if (daysAgo > 1 && daysAgo < 7) {
    const { weekday = "" } = parts(date, { weekday: "long" }, style.intl);
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${time}`;
  }
  return formatDay(date, locale);
}

/**
 * A day, as the movements write it after a week (spec, 9.3): "11/10" in Spanish and "Oct 11" in English, in Buenos
 * Aires time. The week summary's days too (spec, 9.4).
 */
export function formatDay(date: Date, locale: Locale): string {
  if (locale === "en") {
    const { day, month } = parts(date, { day: "numeric", month: "short" }, STYLE.en.intl);
    return `${month} ${day}`;
  }
  const { day, month } = parts(date, { day: "numeric", month: "numeric" });
  return `${day}/${month}`;
}

/** Two letters for an avatar: the first of two words, or the first two of one. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2);
  return letters.toUpperCase();
}
