import { CURRENCIES, type Currency, WARS } from "@tesoreria/agent";
import type { Call } from "@tesoreria/wallet";
import { type Address, encodeFunctionData, erc20Abi, getAddress, isAddress, isAddressEqual, zeroAddress } from "viem";
import { plainPesos, rampTokenOf } from "./contribute";
import { WARS_SPECK, amountExamples, formatMoney, parseMoney } from "./format";
import type { Messages } from "./i18n/messages";

/**
 * Vender con Ripio (spec, 9, pantalla 8): Ripio's off-ramp for the fund's currency on Celo, in the currency's own
 * country, with the amount to sell when there is one. After the number of the member's bank account (the CBU, CVU or
 * alias in Argentina, the CLABE in Mexico), it gives a Celo address, one per network, that sells what reaches it 1:1 and
 * sends the money to the member's bank: the address this panel sends to, as it does to the app's deposit one.
 */
export function offRampUrl(currency: Currency, amount?: bigint): string {
  const amountParam = amount !== undefined && amount > 0n ? `&amount=${plainPesos(amount)}` : "";
  return `https://ramp.ripio.com/offramp?country=${currency.country}&chain=42220&token=${rampTokenOf(currency)}${amountParam}`;
}

/**
 * Pasar a pesos (spec, 9.2): the member's own tokens of the fund's currency (`token`), sent to a Ripio address on Celo:
 * Vender con Ripio's, which sells them and pays the bank, or the app's deposit one, where they're sold 1:1. One call,
 * the only way the paymaster sponsors it (spec, 6).
 */
export function cashOutCalls({ token, to, amount }: { token: Address; to: Address; amount: bigint }): Call[] {
  return [{ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) }];
}

/** Every token TesorerIA's funds hold: each of the agent's currencies, and each dollar a currency's funds take. */
const OUR_TOKENS: readonly Address[] = CURRENCIES.flatMap((currency) => (currency.dollar === null ? [currency.token] : [currency.token, currency.dollar.token]));

/**
 * What's wrong with the address pasted as the member's Ripio one, in the page's language, or null. Strict: an address with
 * capitals must carry its checksum, so a mistyped letter shows; one from Tron or Bitcoin isn't an address at all. The
 * member's own account, the fund and every token of ours (any currency's and any dollar, in any fund) are TesorerIA's:
 * tokens sent straight to the fund, without contribute, are credited to nobody, and sent to another token's contract
 * they're lost for good. The paymaster doesn't look at the destination (spec, 6): this is the only check, for the
 * person's sake.
 */
export function cashOutProblem(text: string, { account, fund }: { account: Address; fund: Address }, m: Messages): string | null {
  const address = text.trim();
  if (!isAddress(address, { strict: true }) || isAddressEqual(address, zeroAddress)) return m.cashOut.badAddress;
  if (isAddressEqual(address, account)) return m.cashOut.ownAccount;
  if ([fund, ...OUR_TOKENS].some((ours) => isAddressEqual(address, ours))) return m.cashOut.ours;
  return null;
}

export type CashOutReading = { ok: true; amount: bigint } | { ok: false; error: string };

/**
 * How much to pass. While the field is untouched (`text` null), all the account holds, to its last unit, so no cents
 * are left behind; otherwise what was typed, up to what it holds. An amount typed as the field shows all of it is all
 * of it, even when the field rounded it to the cent. Below half a cent there's nothing to pass.
 */
export function readCashOutAmount(text: string | null, held: bigint, m: Messages): CashOutReading {
  if (held < WARS_SPECK) return { ok: false, error: m.cashOut.nothingToPass };
  if (text === null) return { ok: true, amount: held };
  const amount = parseMoney(text, m);
  if (amount === null) return { ok: false, error: m.errors.amountFormat(...amountExamples(10_000n, m)) };
  if (formatMoney(amount, m) === formatMoney(held, m)) return { ok: true, amount: held };
  if (amount > held) return { ok: false, error: m.cashOut.accountHolds(formatMoney(held, m)) };
  return { ok: true, amount };
}

const ripioKey = (account: Address, currency: Address) => `tesoreria:ripio:${account.toLowerCase()}:${currency.toLowerCase()}`;
/** What the browser kept before there was one address per currency, when wARS was the only one. */
const oldRipioKey = (account: Address) => `tesoreria:ripio:${account.toLowerCase()}`;

/** The browser's storage, or undefined where there's none or reaching it throws (blocked site data, some private windows). */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The Ripio address this browser remembers for `account` to sell `currency` through (spec, 9.2: only the browser keeps
 * it, never the server), or null: none, a storage that can't be read, or something that isn't an address. One per
 * currency: the address that sells wARS must never come up prefilled to send another currency to. One kept before
 * that, under the account alone, was wARS's, and is read as that and nothing else.
 */
export function rememberedRipioAddress(storage: Pick<Storage, "getItem"> | undefined, account: Address, currency: Address): Address | null {
  let value: string | null;
  try {
    value = storage?.getItem(ripioKey(account, currency)) ?? null;
    if (value === null && currency.toLowerCase() === WARS.toLowerCase()) value = storage?.getItem(oldRipioKey(account)) ?? null;
  } catch {
    return null;
  }
  return value !== null && isAddress(value, { strict: true }) && !isAddressEqual(value, zeroAddress) ? getAddress(value) : null;
}

/** Remembers `address` as `account`'s Ripio one for `currency`, after a pass that went well. A storage that refuses is fine: the field asks again. */
export function rememberRipioAddress(storage: Pick<Storage, "setItem"> | undefined, account: Address, currency: Address, address: Address): void {
  try {
    storage?.setItem(ripioKey(account, currency), address);
  } catch {
    // Full, blocked or private: nothing to do.
  }
}
