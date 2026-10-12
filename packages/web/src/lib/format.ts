/** A space that never breaks a line: "$ 87.500" stays in one piece (spec, 9.1). */
export const NBSP = "\u00A0";
export const WARS_UNIT = 10n ** 18n;
export const USDT_UNIT = 10n ** 6n;
/** The most any amount typed in the app may be, $ 1.000.000.000.000: beyond anything real, far below uint256. */
export const MAX_PESOS = 1_000_000_000_000n * WARS_UNIT;
const CENT = 10n ** 16n;
const TIME_ZONE = "America/Argentina/Buenos_Aires";

function thousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Pesos from wARS units: "$ 87.500", or "$ 16.050,37" when there are cents, rounded half up (spec, 9.1). */
export function formatPesos(units: bigint): string {
  const negative = units < 0n;
  const cents = ((negative ? -units : units) + CENT / 2n) / CENT;
  const rest = cents % 100n;
  const text = `$${NBSP}${thousands((cents / 100n).toString())}${rest === 0n ? "" : `,${rest.toString().padStart(2, "0")}`}`;
  return negative ? `-${text}` : text;
}

/** USDT from its 6-decimal units: "10 USDT", "10,5 USDT". */
export function formatUsdt(units: bigint): string {
  const cents = (units + 5_000n) / 10_000n;
  const rest = cents % 100n;
  const decimals = rest === 0n ? "" : `,${rest.toString().padStart(2, "0").replace(/0$/, "")}`;
  return `${thousands((cents / 100n).toString())}${decimals}${NBSP}USDT`;
}

/**
 * What a member's own account holds, as the inicio says it ("En tu cuenta tenés …"): pesos, then USDT, leaving out
 * what rounds to zero, since a speck of either says nothing.
 */
export function heldAmounts({ wars, usdt }: { wars: bigint; usdt: bigint }): string[] {
  const amounts: string[] = [];
  if (wars >= CENT / 2n) amounts.push(formatPesos(wars));
  if (usdt >= 5_000n) amounts.push(formatUsdt(usdt));
  return amounts;
}

/**
 * An amount typed in pesos, as wARS units, or null. The Argentine way: dots for thousands (in groups of three)
 * and a comma for up to two decimals. A dot that isn't a thousands separator ("10.5") is refused instead of
 * guessed, and so is a group that starts with a zero ("0.500" is not 500), and anything that isn't more than zero.
 */
export function parsePesos(input: string): bigint | null {
  // `\s` takes the no-break space too, so "$ 45.000" copied out of the app's own screens reads back.
  const text = input.replace(/\s/g, "").replace(/^\$/, "");
  const match = /^([1-9]\d{0,2}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(text);
  if (match === null) return null;
  const whole = (match[1] ?? "").replaceAll(".", "");
  const decimals = (match[2] ?? "").padEnd(2, "0");
  const units = BigInt(whole) * WARS_UNIT + BigInt(decimals) * CENT;
  return units > 0n ? units : null;
}

/** An amount typed in USDT, as USDT units, or null: written like pesos (parsePesos), to the cent, with or without "USDT". */
export function parseUsdt(input: string): bigint | null {
  const asPesos = parsePesos(input.replace(/\s*USDT\s*$/i, ""));
  return asPesos === null ? null : asPesos / 10n ** 12n;
}

function parts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const formatted = new Intl.DateTimeFormat("es-AR", { timeZone: TIME_ZONE, ...options }).formatToParts(date);
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

function dayNumber(date: Date): number {
  const { year, month, day } = parts(date, { year: "numeric", month: "numeric", day: "numeric" });
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000;
}

/** "Hoy, 10:15", "Ayer, 18:02", "Lunes, 9:00" within the last week, then "12/10" (spec, 9.2). */
export function formatWhen(date: Date, now: Date): string {
  const { hour, minute } = parts(date, { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const time = `${Number(hour)}:${minute}`;
  const daysAgo = dayNumber(now) - dayNumber(date);
  if (daysAgo === 0) return `Hoy, ${time}`;
  if (daysAgo === 1) return `Ayer, ${time}`;
  if (daysAgo > 1 && daysAgo < 7) {
    const { weekday = "" } = parts(date, { weekday: "long" });
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${time}`;
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
