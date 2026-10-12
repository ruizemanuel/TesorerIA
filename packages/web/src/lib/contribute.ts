import { USDT, WARS } from "@tesoreria/agent";
import type { Call } from "@tesoreria/wallet";
import { type Address, encodeFunctionData, erc20Abi } from "viem";
import { MAX_PESOS, USDT_UNIT, formatPesos, formatUsdt, parsePesos, parseUsdt } from "./format";
import { DEFAULT_BALANCE_CAP, memberFundAbi } from "./fund-abi";

/** Binance's minimum USDT withdrawal on Celo (spec, 10). */
export const MIN_BINANCE_USDT = 5_000_000n;

/** Approve exactly `amount` to the fund and contribute it: one UserOperation (spec, 9, Aportar). */
export function contributeCalls({ fund, token, amount }: { fund: Address; token: "wars" | "usdt"; amount: bigint }): Call[] {
  return [
    { to: token === "usdt" ? USDT : WARS, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [fund, amount] }) },
    {
      to: fund,
      data: encodeFunctionData({ abi: memberFundAbi, functionName: token === "usdt" ? "contributeUsdt" : "contributeWars", args: [amount] }),
    },
  ];
}

/** Pesos as Ripio's form reads them: "10000", or "10000.5" with cents. */
function plainPesos(units: bigint): string {
  const cents = units / 10n ** 16n;
  const rest = cents % 100n;
  return `${cents / 100n}${rest === 0n ? "" : `.${rest.toString().padStart(2, "0").replace(/0$/, "")}`}`;
}

/**
 * Ripio's ramp for wARS on Celo, paid into the member's own account, with the amount to load when there is one;
 * "Continue manually" fills the form (spec, 10).
 */
export function rampUrl(account: Address, amount?: bigint): string {
  const amountParam = amount !== undefined && amount > 0n ? `&amount=${plainPesos(amount)}` : "";
  return `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS${amountParam}&address=${account}`;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** What fits in the fund before it reaches its cap, given the balance it has now (spec, 4). */
export function roomUnderCap(balance: bigint): bigint {
  return DEFAULT_BALANCE_CAP > balance ? DEFAULT_BALANCE_CAP - balance : 0n;
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
 * someone just paid back would otherwise put it all back in (spec, 8.3).
 */
export function defaultWarsAmount({ held, owed, weeklyFee, room }: { held: bigint; owed: bigint; weeklyFee: bigint; room: bigint | null }): bigint {
  return min(held, weeklyContribution({ owed, weeklyFee, room }));
}

/** An amount of pesos as the field shows it, without the sign: "10.000". */
export function pesosText(units: bigint): string {
  return formatPesos(units).replace(/^\$\s/, "");
}

export type PesosReading = { ok: true; amount: bigint } | { ok: false; error: string };

/** What a member reads when what they typed doesn't fit under the fund's cap; `roomText` is the room in their tab's unit. */
function overCap(room: bigint, roomText: string): string {
  const cap = formatPesos(DEFAULT_BALANCE_CAP);
  return room === 0n ? `El fondo llegó a su tope de ${cap}: no entra más.` : `Al fondo le entran hasta ${roomText} más, porque tiene un tope de ${cap}.`;
}

/** What a member typed in the amount field, or a Spanish sentence that says what to fix. */
export function readPesosAmount(text: string, { held, room }: { held: bigint; room: bigint | null }): PesosReading {
  const amount = parsePesos(text);
  if (amount === null) return { ok: false, error: "Escribilo como 10.000 o 10.000,50." };
  if (amount > MAX_PESOS) return { ok: false, error: `No puede pasar de ${formatPesos(MAX_PESOS)}.` };
  if (amount > held) return { ok: false, error: `En tu cuenta tenés ${formatPesos(held)}.` };
  if (room !== null && amount > room) return { ok: false, error: overCap(room, formatPesos(room)) };
  return { ok: true, amount };
}

/**
 * 0,1 %: what Aportar adds to the USDT that covers an amount of pesos, so a small move of the fund's average price
 * before it lands still covers it. What goes over counts as paid ahead (memberDues adds up every week's fee).
 */
export const USDT_MARGIN_BPS = 10n;
const BPS = 10_000n;
/** A hundredth of a USDT: amounts in USDT are shown and typed to the cent. */
const USDT_CENT = 10_000n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const centUp = (units: bigint) => ceilDiv(units, USDT_CENT) * USDT_CENT;
const centDown = (units: bigint) => (units / USDT_CENT) * USDT_CENT;

/** What `usdt` is worth in wARS at `rate`: the fund's quoteUsdtInWars for one USDT, the pool's 30-minute average. */
export function usdtWorth(usdt: bigint, rate: bigint): bigint {
  return (usdt * rate) / USDT_UNIT;
}

/** The USDT that covers `pesos` at `rate`, plus USDT_MARGIN_BPS, rounded up to the cent the field shows. */
export function usdtFor(pesos: bigint, rate: bigint): bigint {
  return centUp(ceilDiv(pesos * (BPS + USDT_MARGIN_BPS) * USDT_UNIT, rate * BPS));
}

/** What the USDT tab knows: what the member holds, the fund's rate (null if it couldn't be read), and their week. */
export type UsdtOffer = { held: bigint; rate: bigint | null; owed: bigint; weeklyFee: bigint; room: bigint | null };

/**
 * The USDT Aportar offers by default (spec, 9, pantalla 3): what covers this week's contribution at the fund's rate,
 * like the pesos' tab, or all the member holds when it's less; never more than fits under the cap. Without a rate,
 * all they hold, as before there was one.
 */
export function defaultUsdtAmount({ held, rate, owed, weeklyFee, room }: UsdtOffer): bigint {
  if (rate === null) return held;
  const fits = fitUnderCap(held, usdtWorth(held, rate), room);
  return min(usdtFor(weeklyContribution({ owed, weeklyFee, room }), rate), fits);
}

/**
 * How much more USDT to send so the account covers this week's contribution, rounded up to the cent: 0 once what's
 * there does, null without a rate.
 */
export function usdtToSend({ held, rate, owed, weeklyFee, room }: UsdtOffer): bigint | null {
  if (rate === null) return null;
  const needed = usdtFor(weeklyContribution({ owed, weeklyFee, room }), rate);
  return needed > held ? centUp(needed - held) : 0n;
}

/** An amount of USDT as the field shows it, without the unit: "6,26". */
export function usdtText(units: bigint): string {
  return formatUsdt(units).replace(/\sUSDT$/, "");
}

export type UsdtReading = { ok: true; amount: bigint } | { ok: false; error: string };

/** What a member typed in the USDT field, or a Spanish sentence that says what to fix. */
export function readUsdtAmount(
  text: string,
  { held, rate, room }: { held: bigint; rate: bigint | null; room: bigint | null },
): UsdtReading {
  const amount = parseUsdt(text);
  if (amount === null) return { ok: false, error: "Escribilo como 6 o 6,25." };
  if (amount > held) return { ok: false, error: `En tu cuenta tenés ${formatUsdt(held)}.` };
  if (rate !== null && room !== null && usdtWorth(amount, rate) > room) {
    return { ok: false, error: overCap(room, formatUsdt(centDown(fitUnderCap(held, usdtWorth(held, rate), room)))) };
  }
  return { ok: true, amount };
}

/**
 * What an amount of USDT comes to, as the panel says it under the field: that it covers `target` (this week's
 * contribution) when it's that plus at most 1 % and a cent, the margin's doing, or what it's worth otherwise.
 */
export function usdtWorthText(amount: bigint, rate: bigint, target: bigint): string {
  const worth = usdtWorth(amount, rate);
  return worth >= target && worth - target <= target / 100n + usdtWorth(USDT_CENT, rate)
    ? `Cubre los ${formatPesos(target)}, al precio de ahora.`
    : `Son unos ${formatPesos(worth)} al precio de ahora.`;
}
