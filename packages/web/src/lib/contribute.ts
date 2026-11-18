import { type FundVersion, fundV2Abi } from "@tesoreria/agent";
import type { Call } from "@tesoreria/wallet";
import { type Address, encodeFunctionData, erc20Abi } from "viem";
import { MAX_PESOS, USDT_UNIT, formatPesos, formatUsdt, parsePesos, parseUsdt, upToCentavo } from "./format";
import { DEFAULT_BALANCE_CAP, memberFundAbi } from "./fund-abi";
import type { Locale } from "./i18n/locales";
import type { Messages } from "./i18n/messages";

/** Binance's minimum USDT withdrawal on Celo (spec, 10). */
export const MIN_BINANCE_USDT = 5_000_000n;

/**
 * Approve exactly `amount` of the fund's currency or dollar to it and contribute it: one UserOperation (spec, 9, Aportar).
 * Version 1 takes wARS and USDT by contributeWars and contributeUsdt; version 2 its own currency and dollar by
 * contribute and contributeDollar. A fund with no dollar (`dollar` null) takes none.
 */
export function contributeCalls({
  fund,
  version,
  token,
  amount,
  currency,
  dollar,
}: {
  fund: Address;
  version: FundVersion;
  token: "wars" | "usdt";
  amount: bigint;
  currency: Address;
  dollar: Address | null;
}): Call[] {
  const paid = token === "usdt" ? dollar : currency;
  if (paid === null) throw new Error(`Fund ${fund} takes no dollar`);
  const contribute =
    version === 2
      ? encodeFunctionData({ abi: fundV2Abi, functionName: token === "usdt" ? "contributeDollar" : "contribute", args: [amount] })
      : encodeFunctionData({ abi: memberFundAbi, functionName: token === "usdt" ? "contributeUsdt" : "contributeWars", args: [amount] });
  return [
    { to: paid, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [fund, amount] }) },
    { to: fund, data: contribute },
  ];
}

/** Pesos as Ripio's form reads them: "10000", or "10000.5" with cents. */
export function plainPesos(units: bigint): string {
  const cents = units / 10n ** 16n;
  const rest = cents % 100n;
  return `${cents / 100n}${rest === 0n ? "" : `.${rest.toString().padStart(2, "0").replace(/0$/, "")}`}`;
}

/**
 * Ripio's ramp for wARS on Celo, paid into the member's own account, with the amount to load when there is one. Since
 * 5/11 it goes straight to Ripio's widget; on 7/10 it stopped at "Continue manually", which filled the form (spec, 10).
 */
export function rampUrl(account: Address, amount?: bigint): string {
  const amountParam = amount !== undefined && amount > 0n ? `&amount=${plainPesos(amount)}` : "";
  return `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS${amountParam}&address=${account}`;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const BPS = 10_000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * What a version 2 fund needs to receive to credit `net` (spec, 5.5): FundV2.contribute credits what arrives less
 * floor(x × feeBps / BPS), so this credits `net`, or a wei more. With no fee, `net` itself.
 */
export function withFee(net: bigint, feeBps: number): bigint {
  return ceilDiv(net * BPS, BPS - BigInt(feeBps));
}

/**
 * What can go in before the fund reaches its cap (spec, 4), given what the contract counts toward it now (FundView's
 * `counted`): what is left of the cap, grossed up by the fee each contribution leaves (`feeBps`), rounded down, so
 * that with its fee off it never passes the cap. With no fee, what is left of the cap: a version 1 fund's, and a
 * version 2 fund's for dollars, which it counts whole while they wait.
 */
export function roomUnderCap(counted: bigint, cap: bigint, feeBps: number): bigint {
  return cap > counted ? ((cap - counted) * BPS) / (BPS - BigInt(feeBps)) : 0n;
}

/**
 * How much of `held` fits in `room`, in the units of `held`. `heldValue` is what all of `held` is worth in wARS,
 * the same as `held` for wARS itself. Without a room or a worth to compare there is nothing to fit against.
 */
export function fitUnderCap(held: bigint, heldValue: bigint | null, room: bigint | null): bigint {
  if (room === null || heldValue === null || heldValue <= room) return held;
  return (held * room) / heldValue;
}

/** What a member puts in this week: what they owe, or the weekly fee when they're up to date, within the room. */
export function weeklyContribution({ owed, weeklyFee, room }: { owed: bigint; weeklyFee: bigint; room: bigint | null }): bigint {
  const due = owed > 0n ? owed : weeklyFee;
  return room === null ? due : min(due, room);
}

/**
 * The wARS Aportar offers by default. Never the whole balance: reimbursements land in the same account, so
 * someone just paid back would otherwise put it all back in (spec, 8.3). In a version 2 fund, what credits the week
 * whole after its fee (withFee), within `room`, which is what goes in before the fee (roomUnderCap).
 */
export function defaultWarsAmount({
  held,
  owed,
  weeklyFee,
  room,
  feeBps = 0,
}: {
  held: bigint;
  owed: bigint;
  weeklyFee: bigint;
  room: bigint | null;
  /** The fund's fee, in basis points: 0 in version 1. */
  feeBps?: number;
}): bigint {
  const due = withFee(weeklyContribution({ owed, weeklyFee, room: null }), feeBps);
  return min(held, room === null ? due : min(due, room));
}

/** An amount of pesos as the field shows it, without the sign: "10.000", or "10,000" in English. */
export function pesosText(units: bigint, locale: Locale): string {
  return formatPesos(units, locale).replace(/^(\$|ARS)\s/, "");
}

export type PesosReading = { ok: true; amount: bigint } | { ok: false; error: string };

/**
 * What a member reads when what they typed doesn't fit under the fund's cap; `roomText` is the room in their tab's unit,
 * and `cap` the fund's.
 */
function overCap(room: bigint, roomText: string, cap: bigint, m: Messages): string {
  const capText = formatPesos(cap, m.locale);
  return room === 0n ? m.contribute.capReached(capText) : m.contribute.roomLeft(roomText, capText);
}

/**
 * What a member typed in the amount field, or a sentence in the page's language that says what to fix. `cap` is the
 * fund's, the default one every fund the web makes has unless said.
 */
export function readPesosAmount(
  text: string,
  { held, room, cap = DEFAULT_BALANCE_CAP }: { held: bigint; room: bigint | null; cap?: bigint },
  m: Messages,
): PesosReading {
  const amount = parsePesos(text, m.locale);
  if (amount === null) return { ok: false, error: m.errors.amountFormat };
  if (amount > MAX_PESOS) return { ok: false, error: m.errors.amountTooBig(formatPesos(MAX_PESOS, m.locale)) };
  if (amount > held) return { ok: false, error: m.contribute.accountHolds(formatPesos(held, m.locale)) };
  if (room !== null && amount > room) return { ok: false, error: overCap(room, formatPesos(room, m.locale), cap, m) };
  return { ok: true, amount };
}

/**
 * The pesos tab's field: what it shows, and what it sends. Untouched, a version 1 fund shows `offered` to the nearest
 * centavo and sends what that reads back, as it always did; a version 2 fund shows it up to the centavo and sends it
 * exact, since `offered` is what credits the week whole after the fee (withFee) and what it shows is a fraction of a
 * centavo over it. Typed, it sends what was typed.
 */
export function warsField(
  typed: string | null,
  offered: bigint,
  version: FundVersion,
  limits: { held: bigint; room: bigint | null; cap?: bigint },
  m: Messages,
): { value: string; reading: PesosReading } {
  if (typed === null && version === 2) return { value: pesosText(upToCentavo(offered), m.locale), reading: { ok: true, amount: offered } };
  const value = typed ?? pesosText(offered, m.locale);
  return { value, reading: readPesosAmount(value, limits, m) };
}

/**
 * 0,3 %: what Aportar adds to the USDT that covers an amount of pesos, so a small move of the fund's average price
 * before it lands, and what converting it loses (conversionLoss), still cover it: the worst of 37 conversions measured
 * on 16/11/2026 lost 0,24 %. What its conversion gets over the fee counts as paid ahead, money the fund does hold
 * (memberDues adds up every week's fee), so the margin costs no one anything (conversion-loss design).
 */
export const USDT_MARGIN_BPS = 30n;
/** A hundredth of a USDT: amounts in USDT are shown and typed to the cent. */
const USDT_CENT = 10_000n;

const centUp = (units: bigint) => ceilDiv(units, USDT_CENT) * USDT_CENT;
const centDown = (units: bigint) => (units / USDT_CENT) * USDT_CENT;

/** What `usdt` is worth in wARS at `rate`: the fund's quoteUsdtInWars for one USDT, the pool's 30-minute average. */
export function usdtWorth(usdt: bigint, rate: bigint): bigint {
  return (usdt * rate) / USDT_UNIT;
}

/**
 * The USDT that covers `pesos` at `rate`, plus `marginBps`, rounded up to the cent the field shows. A version 2 fund
 * adds its fee to USDT_MARGIN_BPS, on the week's own pesos, so the fee is asked once (marginOf).
 */
export function usdtFor(pesos: bigint, rate: bigint, marginBps: bigint = USDT_MARGIN_BPS): bigint {
  return centUp(ceilDiv(pesos * (BPS + marginBps) * USDT_UNIT, rate * BPS));
}

/** The margin Aportar adds to USDT: what converting it may lose, and the fee its conversion leaves (none in version 1). */
const marginOf = (feeBps = 0) => USDT_MARGIN_BPS + BigInt(feeBps);

/**
 * The fund's rate after a refresh: the fresh one, or the last one read when this refresh failed (`fresh` is null) or
 * came back zero, which is no price. Null only until a first rate has been read: a blip must not turn what Aportar
 * offers from "just enough" into "all you hold" until the next look.
 */
export function nextRate(previous: bigint | null, fresh: bigint | null): bigint | null {
  return fresh !== null && fresh > 0n ? fresh : previous;
}

/**
 * What the USDT tab knows: what the member holds, the fund's rate (null if it couldn't be read), their week, and the
 * fund's fee in basis points (0, or left out, in version 1). `room` is in pesos at the fund's rate, with no fee:
 * a version 2 fund counts pending dollars whole toward its cap.
 */
export type UsdtOffer = { held: bigint; rate: bigint | null; owed: bigint; weeklyFee: bigint; room: bigint | null; feeBps?: number };

/**
 * The USDT Aportar offers by default (spec, 9, pantalla 3): what covers this week's contribution at the fund's rate,
 * like the pesos' tab, or all the member holds when it's less; never more than fits under the cap, and when the cap
 * is what limits it, to the cent below what fits: that is what the field shows and what readUsdtAmount takes, and
 * leaves up to a cent for the fund's rate to rise before it lands. Without a rate, all they hold, as before there was one.
 */
export function defaultUsdtAmount({ held, rate, owed, weeklyFee, room, feeBps }: UsdtOffer): bigint {
  if (rate === null) return held;
  const fits = fitUnderCap(held, usdtWorth(held, rate), room);
  const underCap = fits < held ? centDown(fits) : held; // `fits` is less than `held` only when the cap binds
  return min(usdtFor(weeklyContribution({ owed, weeklyFee, room }), rate, marginOf(feeBps)), underCap);
}

/**
 * How much more USDT to send so the account covers this week's contribution, rounded up to the cent: 0 once what's
 * there does, null without a rate.
 */
export function usdtToSend({ held, rate, owed, weeklyFee, room, feeBps }: UsdtOffer): bigint | null {
  if (rate === null) return null;
  const needed = usdtFor(weeklyContribution({ owed, weeklyFee, room }), rate, marginOf(feeBps));
  return needed > held ? centUp(needed - held) : 0n;
}

/** An amount of USDT as the field shows it, without the unit: "6,26", or "6.26" in English. */
export function usdtText(units: bigint, locale: Locale): string {
  return formatUsdt(units, locale).replace(/\sUSDT$/, "");
}

export type UsdtReading = { ok: true; amount: bigint } | { ok: false; error: string };

/** What a member typed in the USDT field, or a sentence in the page's language that says what to fix. */
export function readUsdtAmount(
  text: string,
  { held, rate, room, cap = DEFAULT_BALANCE_CAP }: { held: bigint; rate: bigint | null; room: bigint | null; cap?: bigint },
  m: Messages,
): UsdtReading {
  const amount = parseUsdt(text, m.locale);
  if (amount === null) return { ok: false, error: m.contribute.usdtFormat };
  if (amount > held) return { ok: false, error: m.contribute.accountHolds(formatUsdt(held, m.locale)) };
  if (rate !== null && room !== null && usdtWorth(amount, rate) > room) {
    const fits = formatUsdt(centDown(fitUnderCap(held, usdtWorth(held, rate), room)), m.locale);
    return { ok: false, error: overCap(room, fits, cap, m) };
  }
  return { ok: true, amount };
}

/**
 * What an amount of USDT comes to, as the panel says it under the field: that it covers `target` (this week's
 * contribution) when it's that plus at most 1 % and a cent, the margin's doing, or what it's worth otherwise.
 */
export function usdtWorthText(amount: bigint, rate: bigint, target: bigint, m: Messages): string {
  const worth = usdtWorth(amount, rate);
  return worth >= target && worth - target <= target / 100n + usdtWorth(USDT_CENT, rate)
    ? m.contribute.covers(formatPesos(target, m.locale))
    : m.contribute.worth(formatPesos(worth, m.locale));
}
