import type { Country, MoneyStyle, Speech } from "./countries";
import { LOCALES, type Locale } from "./i18n/locales";

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

/** What each language calls the last two days (spec, 9.2 and 9.3). */
const DAYS: Record<Locale, { today: string; yesterday: string }> = {
  es: { today: "Hoy", yesterday: "Ayer" },
  en: { today: "Today", yesterday: "Yesterday" },
};

/** How `speech` writes numbers: its country's way, in its language (spec, 9.3). */
function styleOf({ locale, country }: Speech): MoneyStyle {
  return country.money[locale];
}

/**
 * The tag `Intl` knows a language by in a country: what writes a date in words ("jueves, 15 de octubre", "Thursday,
 * October 15").
 */
export function intlLocale({ locale, country }: Speech): string {
  return country.intl[locale];
}

function thousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * An amount of a currency's units (18 decimals) after `prefix`, with `style`'s separators, rounded half up to the cent:
 * the cents show only when there are some.
 */
function written(units: bigint, prefix: string, style: MoneyStyle): string {
  const negative = units < 0n;
  const cents = ((negative ? -units : units) + CENT / 2n) / CENT;
  const rest = cents % 100n;
  const whole = thousands((cents / 100n).toString(), style.thousands);
  const text = `${prefix}${whole}${rest === 0n ? "" : `${style.decimal}${rest.toString().padStart(2, "0")}`}`;
  return negative ? `-${text}` : text;
}

/**
 * An amount of the country's currency, as its language writes it there (spec, 9.1 and 9.3): in Argentina "$ 87.500" or
 * "$ 16.050,37" in Spanish, "ARS 87,500" or "ARS 16,050.37" in English, since in English "$" would read as dollars; in
 * Mexico "$87,500" and "MXN 87,500". Rounded half up to the cent.
 */
export function formatMoney(units: bigint, speech: Speech): string {
  const style = styleOf(speech);
  return written(units, `${style.mark}${style.space ? NBSP : ""}`, style);
}

/** The same number formatMoney writes, without the mark: "10.000" in Argentine Spanish, "10,000" in English or in Mexico. */
export function formatAmount(units: bigint, speech: Speech): string {
  return written(units, "", styleOf(speech));
}

/**
 * Another country's money on `speech`'s screen: the code of `of`'s currency, then the amount with the screen's
 * separators ("ARS 16,050.37" on a screen of Mexico), so it reads neither as the screen's own pesos nor backwards.
 */
export function formatForeignMoney(units: bigint, of: Country, speech: Speech): string {
  return written(units, `${of.words[speech.locale].code}${NBSP}`, styleOf(speech));
}

/**
 * The currency's units up to the next whole centavo: what's missing said so it's enough. formatMoney rounds to the
 * nearest, so a shortfall of a fraction of a centavo would read "$ 0".
 */
export function upToCentavo(units: bigint): bigint {
  return ((units + CENT - 1n) / CENT) * CENT;
}

/** The currency's units down to a whole centavo: a most said so that typing it never asks for more than there is. */
export function downToCentavo(units: bigint): bigint {
  return (units / CENT) * CENT;
}

/**
 * Basis points as a percentage, the way the language writes it in the country: "0,25 %" in Argentine Spanish, with a
 * space that doesn't break before the sign, and "0.25%" in English or in Mexico. A v2 fund's fee (feeBps).
 */
export function formatPercent(bps: number, speech: Speech): string {
  const style = styleOf(speech);
  const rest = bps % 100;
  const decimals = rest === 0 ? "" : `${style.decimal}${rest.toString().padStart(2, "0").replace(/0$/, "")}`;
  return `${Math.floor(bps / 100)}${decimals}${style.percentSpace ? NBSP : ""}%`;
}

/** USDT from its 6-decimal units, with the screen's separators: "10 USDT", "10,5 USDT" ("10.5 USDT" in English). */
export function formatUsdt(units: bigint, speech: Speech): string {
  return `${formatUsdtAmount(units, speech)}${NBSP}USDT`;
}

/** The same number formatUsdt writes, without the unit: "10,5", or "10.5" in English. */
export function formatUsdtAmount(units: bigint, speech: Speech): string {
  const style = styleOf(speech);
  const cents = (units + 5_000n) / 10_000n;
  const rest = cents % 100n;
  const decimals = rest === 0n ? "" : `${style.decimal}${rest.toString().padStart(2, "0").replace(/0$/, "")}`;
  return `${thousands((cents / 100n).toString(), style.thousands)}${decimals}`;
}

/**
 * What a member's own account holds, as the inicio says it ("En tu cuenta tenés …"): the fund's currency, then its
 * dollar, leaving out what rounds to zero, since a speck of either says nothing.
 */
export function heldAmounts({ currency, dollar }: { currency: bigint; dollar: bigint }, speech: Speech): string[] {
  const amounts: string[] = [];
  if (currency >= WARS_SPECK) amounts.push(formatMoney(currency, speech));
  if (dollar >= USDT_SPECK) amounts.push(formatUsdt(dollar, speech));
  return amounts;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What an amount looks like with `style`'s separators: thousands in groups of three, then up to two decimals. */
function amountShape({ thousands, decimal }: MoneyStyle): RegExp {
  return new RegExp(`^([1-9]\\d{0,2}(?:${escaped(thousands)}\\d{3})+|\\d+)(?:${escaped(decimal)}(\\d{1,2}))?$`);
}

/**
 * An amount typed in the country's currency, as its units, or null. Each language has its own way in each country: in
 * Argentine Spanish dots for thousands and a comma for up to two decimals ("10.000,50"); in English, and in Mexico, the
 * other way around ("10,000.50"). A separator that can't be what the screen says it is ("10.5" in Argentine Spanish,
 * "10.000" in English or in Mexico) is refused instead of guessed, and so is a group that starts with a zero, and
 * anything that isn't more than zero. The screen's own mark ("$", "ARS", "MXN") or the currency's code may come along,
 * so an amount copied out of the app reads back.
 */
export function parseMoney(input: string, speech: Speech): bigint | null {
  const style = styleOf(speech);
  const marks = [...new Set([style.mark, speech.country.words[speech.locale].code])].map(escaped);
  // `\s` takes the no-break space too, so "$ 45.000" copied out of the app's own screens reads back.
  const text = input.replace(/\s/g, "").replace(new RegExp(`^(?:${marks.join("|")})`, "i"), "");
  const match = amountShape(style).exec(text);
  if (match === null) return null;
  const whole = (match[1] ?? "").replace(/\D/g, "");
  const decimals = (match[2] ?? "").padEnd(2, "0");
  const units = BigInt(whole) * WARS_UNIT + BigInt(decimals) * CENT;
  return units > 0n ? units : null;
}

/**
 * An amount the chat's model wrote, in either of the country's languages' way. The model writes as the page does, but a
 * page can change language mid-conversation. Within one country no text reads as two different amounts
 * (format.test.ts), so trying both is safe; a person's typing is read only in their page's language (parseMoney).
 */
export function parseMoneyInChat(text: string, country: Country): bigint | null {
  for (const locale of LOCALES) {
    const units = parseMoney(text, { locale, country });
    if (units !== null) return units;
  }
  return null;
}

/** An amount typed in USDT, as USDT units, or null: written like the currency on that screen (parseMoney), to the cent, with or without "USDT". */
export function parseUsdt(input: string, speech: Speech): bigint | null {
  const asMoney = parseMoney(input.replace(/\s*USDT\s*$/i, ""), speech);
  return asMoney === null ? null : asMoney / 10n ** 12n;
}

/** The pieces `Intl` writes `date` in, in the language of `speech` and on its country's clock. */
function parts(date: Date, options: Intl.DateTimeFormatOptions, speech: Speech): Record<string, string> {
  const formatted = new Intl.DateTimeFormat(intlLocale(speech), { timeZone: speech.country.timeZone, ...options }).formatToParts(date);
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

function dayNumber(date: Date, speech: Speech): number {
  const { year, month, day } = parts(date, { year: "numeric", month: "numeric", day: "numeric" }, speech);
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000;
}

/**
 * "Hoy, 10:15", "Ayer, 18:02", "Lunes, 9:00" within the last week, then "12/10" (spec, 9.2); in English "Today, 10:15",
 * "Yesterday, 18:02", "Monday, 9:00", then "Oct 12", since "12/10" reads differently in England and in the US (9.3).
 * Always on a 24-hour clock, in the time of the fund's country (Buenos Aires, Mexico City).
 */
export function formatWhen(date: Date, now: Date, speech: Speech): string {
  const days = DAYS[speech.locale];
  const { hour, minute } = parts(date, { hour: "numeric", minute: "2-digit", hourCycle: "h23" }, speech);
  const time = `${Number(hour)}:${minute}`;
  const daysAgo = dayNumber(now, speech) - dayNumber(date, speech);
  if (daysAgo === 0) return `${days.today}, ${time}`;
  if (daysAgo === 1) return `${days.yesterday}, ${time}`;
  if (daysAgo > 1 && daysAgo < 7) {
    const { weekday = "" } = parts(date, { weekday: "long" }, speech);
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${time}`;
  }
  return formatDay(date, speech);
}

/**
 * A day, as the movements write it after a week (spec, 9.3): "11/10" in Spanish and "Oct 11" in English, in the time of
 * the fund's country. The week summary's days too (spec, 9.4).
 */
export function formatDay(date: Date, speech: Speech): string {
  if (speech.locale === "en") {
    const { day, month } = parts(date, { day: "numeric", month: "short" }, speech);
    return `${month} ${day}`;
  }
  const { day, month } = parts(date, { day: "numeric", month: "numeric" }, speech);
  return `${day}/${month}`;
}

/** Two letters for an avatar: the first of two words, or the first two of one. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2);
  return letters.toUpperCase();
}
