import { CURRENCIES, USDT, WARS, currencyOf } from "@tesoreria/agent";
import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { cashOutCalls, cashOutProblem, offRampUrl, readCashOutAmount, rememberRipioAddress, rememberedRipioAddress } from "../src/lib/cash-out";
import { COUNTRIES } from "../src/lib/countries";
import { NBSP, WARS_UNIT, formatMoney } from "../src/lib/format";
import { messagesFor } from "../src/lib/i18n/messages";
import { en, es } from "./support/messages";

const ACCOUNT = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
/** A Mexican fund: its currency is wMXN and it has no dollar. */
const MX_FUND = getAddress("0x00000000000000000000000000000000000f00d2");
const WMXN = COUNTRIES.MX.currency.token;
/** Anvil's second account: it stands in for a Ripio deposit address. */
const RIPIO = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
/** Anvil's third: another Ripio deposit address. */
const OTHER = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
const ours = { account: ACCOUNT, fund: FUND };
/** RIPIO with one capital turned small: the checksum no longer matches. */
const MISTYPED = RIPIO.replace("C51812", "c51812");
const wars = currencyOf(WARS)!;
const wmxn = currencyOf(WMXN)!;

describe("cashOutCalls", () => {
  it("is one transfer of wARS to the address, for the amount, with no value", () => {
    const [call, ...rest] = cashOutCalls({ token: WARS, to: RIPIO, amount: 45_000n * WARS_UNIT });
    expect(rest).toEqual([]);
    expect(call!.to).toBe(WARS);
    expect(call!.value).toBeUndefined();
    expect(decodeFunctionData({ abi: erc20Abi, data: call!.data! })).toEqual({ functionName: "transfer", args: [RIPIO, 45_000n * WARS_UNIT] });
  });

  it("passes the fund's currency, not wARS", () => {
    const [call] = cashOutCalls({ token: WMXN, to: RIPIO, amount: 1n });
    expect(call!.to).toBe(WMXN);
    expect(decodeFunctionData({ abi: erc20Abi, data: call!.data! })).toEqual({ functionName: "transfer", args: [RIPIO, 1n] });
  });
});

describe("offRampUrl", () => {
  it("opens Ripio's sale of wARS on Celo for pesos, which ends in the Celo address to send them to (5/11)", () => {
    expect(offRampUrl(wars)).toBe("https://ramp.ripio.com/offramp?country=AR&chain=42220&token=WARS");
    expect(offRampUrl(wars, 0n)).toBe("https://ramp.ripio.com/offramp?country=AR&chain=42220&token=WARS");
  });

  it("carries the amount, in pesos as Ripio's form reads them", () => {
    expect(offRampUrl(wars, 10_000n * WARS_UNIT)).toBe("https://ramp.ripio.com/offramp?country=AR&chain=42220&token=WARS&amount=10000");
    expect(offRampUrl(wars, 2n * WARS_UNIT + 25n * 10n ** 16n)).toBe("https://ramp.ripio.com/offramp?country=AR&chain=42220&token=WARS&amount=2.25");
  });

  it("sells wMXN through Ripio's off-ramp for Mexico", () => {
    expect(offRampUrl(wmxn, 50n * WARS_UNIT)).toBe("https://ramp.ripio.com/offramp?country=MX&chain=42220&token=WMXN&amount=50");
    expect(offRampUrl(wmxn)).toBe("https://ramp.ripio.com/offramp?country=MX&chain=42220&token=WMXN");
  });

  it("has no off-ramp for a currency Ripio's ramp doesn't serve, rather than a link to a token called null", () => {
    const wpen = CURRENCIES.find((currency) => currency.symbol === "wPEN")!;
    expect(wpen.rampToken).toBeNull();
    expect(() => offRampUrl(wpen)).toThrow("wPEN");
  });
});

describe("cashOutProblem: the Ripio address, checked before signing (spec, 9.2)", () => {
  it("refuses any token of ours as the Ripio address, in any fund", () => {
    const m = messagesFor("es", "MX");
    expect(cashOutProblem(WARS, { account: ACCOUNT, fund: MX_FUND }, m)).toBe(m.cashOut.ours);
    expect(cashOutProblem(USDT, { account: ACCOUNT, fund: MX_FUND }, m)).toBe(m.cashOut.ours);
    expect(cashOutProblem(WMXN, { account: ACCOUNT, fund: MX_FUND }, m)).toBe(m.cashOut.ours);
    expect(cashOutProblem(WMXN.toLowerCase(), { account: ACCOUNT, fund: FUND }, es)).toBe(es.cashOut.ours);
    expect(cashOutProblem(MX_FUND, { account: ACCOUNT, fund: MX_FUND }, m)).toBe(m.cashOut.ours);
    expect(cashOutProblem(RIPIO, { account: ACCOUNT, fund: MX_FUND }, m)).toBeNull();
  });

  it("takes a Ripio address as the app shows it, checksummed or in lowercase, with the spaces of a paste", () => {
    for (const text of [RIPIO, RIPIO.toLowerCase(), `  ${RIPIO} `, `${RIPIO}\n`]) expect(cashOutProblem(text, ours, es), JSON.stringify(text)).toBeNull();
  });

  it("refuses what isn't a Celo address, a checksummed one with a letter changed, and the zero address", () => {
    const tron = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
    const bitcoin = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    for (const text of ["", "0x1234", tron, bitcoin, MISTYPED, `0x${"0".repeat(40)}`]) {
      expect(cashOutProblem(text, ours, es), text).toBe("Esa dirección no parece válida. Copiala de nuevo desde Ripio.");
    }
  });

  it("refuses the member's own account, in any case", () => {
    for (const text of [ACCOUNT, ACCOUNT.toLowerCase()]) expect(cashOutProblem(text, ours, es), text).toBe("Esa es tu cuenta del fondo. Pegá la de Ripio.");
  });

  it("refuses the fund and the two tokens: they're TesorerIA's, not Ripio's", () => {
    for (const text of [FUND, WARS, USDT.toLowerCase()]) expect(cashOutProblem(text, ours, es), text).toBe("Esa dirección es de TesorerIA, no de Ripio.");
  });
});

describe("readCashOutAmount", () => {
  /** $ 45.000,005: the field shows it as $ 45.000,01. */
  const held = 45_000n * WARS_UNIT + 5n * 10n ** 15n;

  it("passes all the account holds, to its last unit, while the field is untouched", () => {
    expect(readCashOutAmount(null, held, es)).toEqual({ ok: true, amount: held });
  });

  it("passes what was typed, up to what the account holds", () => {
    expect(readCashOutAmount("2.000", held, es)).toEqual({ ok: true, amount: 2_000n * WARS_UNIT });
    expect(readCashOutAmount("$ 44.999,99", held, es)).toEqual({ ok: true, amount: 44_999n * WARS_UNIT + 99n * 10n ** 16n });
  });

  it("takes an amount typed as the field shows all of it as all of it, though the field rounded it", () => {
    expect(formatMoney(held, es)).toBe("$ 45.000,01");
    expect(readCashOutAmount("45.000,01", held, es)).toEqual({ ok: true, amount: held });
    const justUnder = 45_000n * WARS_UNIT + 4n * 10n ** 15n; // $ 45.000,004 shows as $ 45.000
    expect(readCashOutAmount("45.000", justUnder, es)).toEqual({ ok: true, amount: justUnder });
  });

  it("says what to fix: a malformed amount, nothing, or more than the account holds", () => {
    expect(readCashOutAmount("2,000.50", held, es)).toEqual({ ok: false, error: "Escribilo como 10.000 o 10.000,50." });
    expect(readCashOutAmount("0", held, es)).toEqual({ ok: false, error: "Escribilo como 10.000 o 10.000,50." });
    expect(readCashOutAmount("45.000,02", held, es)).toEqual({ ok: false, error: `Tenés ${formatMoney(held, es)} en tu cuenta.` });
  });

  it("teaches a Mexican fund's format at Mexico's scale: its weekly dues, $100", () => {
    expect(readCashOutAmount("50,5", 50n * WARS_UNIT, messagesFor("es", "MX"))).toEqual({ ok: false, error: "Escríbelo como 100 o 100.50." });
    expect(readCashOutAmount("50.000", 50n * WARS_UNIT, messagesFor("en", "MX"))).toEqual({ ok: false, error: "Write it like 100 or 100.50." });
  });

  it("has nothing to pass below half a cent, whatever was typed", () => {
    for (const speck of [0n, 5n * 10n ** 15n - 1n]) {
      expect(readCashOutAmount(null, speck, es)).toEqual({ ok: false, error: "No tenés pesos en tu cuenta para pasar." });
      expect(readCashOutAmount("1", speck, es)).toEqual({ ok: false, error: "No tenés pesos en tu cuenta para pasar." });
    }
    expect(readCashOutAmount(null, 5n * 10n ** 15n, es)).toEqual({ ok: true, amount: 5n * 10n ** 15n });
  });
});

describe("Pasar a pesos in English", () => {
  it("takes the field's own amount as all of it, in English too", () => {
    const held = 45_000n * WARS_UNIT + 5n * 10n ** 15n; // shows as ARS 45,000.01
    expect(readCashOutAmount("45,000.01", held, en)).toEqual({ ok: true, amount: held });
    expect(cashOutProblem("0x1234", { account: ACCOUNT, fund: FUND }, en)).toBe(en.cashOut.badAddress);
  });

  it("says what to fix in English, with the language's own amounts", () => {
    const held = 45_000n * WARS_UNIT;
    expect(readCashOutAmount("45.000", held, en)).toEqual({ ok: false, error: "Write it like 10,000 or 10,000.50." });
    expect(readCashOutAmount("45,001", held, en)).toEqual({ ok: false, error: `You have ARS${NBSP}45,000 in your account.` });
    expect(readCashOutAmount(null, 0n, en)).toEqual({ ok: false, error: "You have no pesos in your account to cash out." });
    expect(cashOutProblem(ACCOUNT, ours, en)).toBe("That's your fund account. Paste your Ripio one.");
    expect(cashOutProblem(FUND, ours, en)).toBe("That address belongs to TesorerIA, not Ripio.");
    expect(cashOutProblem(RIPIO, ours, en)).toBeNull();
    expect(en.cashOut.badAddress).toBe("That address doesn't look valid. Copy it again from Ripio.");
    expect(es.cashOut.badAddress).toBe("Esa dirección no parece válida. Copiala de nuevo desde Ripio.");
  });
});

describe("the Ripio address this browser remembers (spec, 9.2)", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const items = new Map(Object.entries(initial));
    return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
  };
  /** What an earlier version kept, for wARS, before there was one address per currency. */
  const OLD_KEY = `tesoreria:ripio:${ACCOUNT.toLowerCase()}`;
  const keyOf = (token: string) => `${OLD_KEY}:${token.toLowerCase()}`;

  it("remembers one per account and currency, and gives it back checksummed", () => {
    const storage = memory();
    rememberRipioAddress(storage, ACCOUNT, WARS, RIPIO);
    expect(rememberedRipioAddress(storage, ACCOUNT, WARS)).toBe(RIPIO);
    expect(rememberedRipioAddress(storage, FUND, WARS)).toBeNull();
    storage.setItem(keyOf(WARS), RIPIO.toLowerCase());
    expect(rememberedRipioAddress(storage, ACCOUNT, WARS)).toBe(RIPIO);
  });

  it("remembers the Ripio address per currency, and reads an old one as wARS's only", () => {
    const storage = memory({ [OLD_KEY]: RIPIO });
    expect(rememberedRipioAddress(storage, ACCOUNT, WARS)).toBe(RIPIO);
    expect(rememberedRipioAddress(storage, ACCOUNT, WMXN)).toBeNull();
    rememberRipioAddress(storage, ACCOUNT, WMXN, OTHER);
    expect(rememberedRipioAddress(storage, ACCOUNT, WMXN)).toBe(OTHER);
    expect(rememberedRipioAddress(storage, ACCOUNT, WARS)).toBe(RIPIO);
  });

  it("writes the key of the account and the currency in lowercase, and the new key wins over the old one", () => {
    const storage = memory({ [OLD_KEY]: RIPIO });
    rememberRipioAddress(storage, ACCOUNT, WARS, OTHER);
    expect(storage.items.get(keyOf(WARS))).toBe(OTHER);
    expect(storage.items.get(OLD_KEY)).toBe(RIPIO); // the old key is left as it was
    expect(rememberedRipioAddress(storage, ACCOUNT, WARS)).toBe(OTHER);
  });

  it("gives back nothing it can't trust, and never throws: no storage, one that throws, or something that isn't an address", () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => rememberRipioAddress(throwing, ACCOUNT, WARS, RIPIO)).not.toThrow();
    expect(rememberedRipioAddress(throwing, ACCOUNT, WARS)).toBeNull();
    expect(() => rememberRipioAddress(undefined, ACCOUNT, WARS, RIPIO)).not.toThrow();
    expect(rememberedRipioAddress(undefined, ACCOUNT, WARS)).toBeNull();
    for (const junk of ["not an address", `0x${"0".repeat(40)}`, MISTYPED]) {
      for (const key of [keyOf(WARS), OLD_KEY]) {
        expect(rememberedRipioAddress(memory({ [key]: junk }), ACCOUNT, WARS), `${junk} under ${key}`).toBeNull();
      }
    }
  });
});
