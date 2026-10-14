import { USDT, WARS } from "@tesoreria/agent";
import type { Call } from "@tesoreria/wallet";
import { type Address, encodeFunctionData, erc20Abi, getAddress, isAddress, isAddressEqual, zeroAddress } from "viem";
import { WARS_SPECK, formatPesos, parsePesos } from "./format";

/**
 * Pasar a pesos (spec, 9.2): the member's own wARS, sent to their Ripio deposit address, where Ripio's app sells them
 * 1:1 for pesos. One call, the only way the paymaster sponsors it (spec, 6).
 */
export function cashOutCalls({ to, amount }: { to: Address; amount: bigint }): Call[] {
  return [{ to: WARS, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) }];
}

/**
 * What's wrong with the address pasted as the member's Ripio one, in Spanish, or null. Strict: an address with
 * capitals must carry its checksum, so a mistyped letter shows; one from Tron or Bitcoin isn't an address at all. The
 * member's own account, the fund and the two tokens are TesorerIA's: wARS sent to the fund without Aportar credit
 * nobody. The paymaster doesn't look at the destination (spec, 6): this is the only check, for the person's sake.
 */
export function cashOutProblem(text: string, { account, fund }: { account: Address; fund: Address }): string | null {
  const address = text.trim();
  if (!isAddress(address, { strict: true }) || isAddressEqual(address, zeroAddress)) {
    return "Esa dirección no parece válida. Copiala de nuevo desde Ripio.";
  }
  if (isAddressEqual(address, account)) return "Esa es tu cuenta del fondo. Pegá la de Ripio.";
  if ([fund, WARS, USDT].some((ours) => isAddressEqual(address, ours))) return "Esa dirección es de TesorerIA, no de Ripio.";
  return null;
}

export type CashOutReading = { ok: true; amount: bigint } | { ok: false; error: string };

/**
 * How much to pass. While the field is untouched (`text` null), all the account holds, to its last unit, so no cents
 * are left behind; otherwise what was typed, up to what it holds. An amount typed as the field shows all of it is all
 * of it, even when the field rounded it to the cent. Below half a cent there's nothing to pass.
 */
export function readCashOutAmount(text: string | null, held: bigint): CashOutReading {
  if (held < WARS_SPECK) return { ok: false, error: "No tenés pesos en tu cuenta para pasar." };
  if (text === null) return { ok: true, amount: held };
  const amount = parsePesos(text);
  if (amount === null) return { ok: false, error: "Escribilo como 10.000 o 10.000,50." };
  if (formatPesos(amount) === formatPesos(held)) return { ok: true, amount: held };
  if (amount > held) return { ok: false, error: `Tenés ${formatPesos(held)} en tu cuenta.` };
  return { ok: true, amount };
}

const ripioKey = (account: Address) => `tesoreria:ripio:${account.toLowerCase()}`;

/** The browser's storage, or undefined where there's none or reaching it throws (blocked site data, some private windows). */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The Ripio address this browser remembers for `account` (spec, 9.2: only the browser keeps it, never the server), or
 * null: none, a storage that can't be read, or something that isn't an address.
 */
export function rememberedRipioAddress(storage: Pick<Storage, "getItem"> | undefined, account: Address): Address | null {
  let value: string | null;
  try {
    value = storage?.getItem(ripioKey(account)) ?? null;
  } catch {
    return null;
  }
  return value !== null && isAddress(value, { strict: true }) && !isAddressEqual(value, zeroAddress) ? getAddress(value) : null;
}

/** Remembers `address` as `account`'s Ripio one, after a pass that went well. A storage that refuses is fine: the field asks again. */
export function rememberRipioAddress(storage: Pick<Storage, "setItem"> | undefined, account: Address, address: Address): void {
  try {
    storage?.setItem(ripioKey(account), address);
  } catch {
    // Full, blocked or private: nothing to do.
  }
}
