import { USDT, WARS } from "@tesoreria/agent";
import type { Call } from "@tesoreria/wallet";
import { type Address, encodeFunctionData, erc20Abi } from "viem";
import { MAX_PESOS, formatPesos, parsePesos } from "./format";
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

/** What a member typed in the amount field, or a Spanish sentence that says what to fix. */
export function readPesosAmount(text: string, { held, room }: { held: bigint; room: bigint | null }): PesosReading {
  const amount = parsePesos(text);
  if (amount === null) return { ok: false, error: "Escribilo como 10.000 o 10.000,50." };
  if (amount > MAX_PESOS) return { ok: false, error: `No puede pasar de ${formatPesos(MAX_PESOS)}.` };
  if (amount > held) return { ok: false, error: `En tu cuenta tenés ${formatPesos(held)}.` };
  if (room !== null && amount > room) {
    const cap = formatPesos(DEFAULT_BALANCE_CAP);
    return {
      ok: false,
      error: room === 0n ? `El fondo llegó a su tope de ${cap}: no entra más.` : `Al fondo le entran hasta ${formatPesos(room)} más, porque tiene un tope de ${cap}.`,
    };
  }
  return { ok: true, amount };
}
