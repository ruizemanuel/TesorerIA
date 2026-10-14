import { USDT, WARS } from "@tesoreria/agent";
import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { cashOutCalls, cashOutProblem, readCashOutAmount, rememberRipioAddress, rememberedRipioAddress } from "../src/lib/cash-out";
import { WARS_UNIT, formatPesos } from "../src/lib/format";

const ACCOUNT = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
/** Anvil's second account: it stands in for a Ripio deposit address. */
const RIPIO = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const ours = { account: ACCOUNT, fund: FUND };
/** RIPIO with one capital turned small: the checksum no longer matches. */
const MISTYPED = RIPIO.replace("C51812", "c51812");

describe("cashOutCalls", () => {
  it("is one transfer of wARS to the address, for the amount, with no value", () => {
    const [call, ...rest] = cashOutCalls({ to: RIPIO, amount: 45_000n * WARS_UNIT });
    expect(rest).toEqual([]);
    expect(call!.to).toBe(WARS);
    expect(call!.value).toBeUndefined();
    expect(decodeFunctionData({ abi: erc20Abi, data: call!.data! })).toEqual({ functionName: "transfer", args: [RIPIO, 45_000n * WARS_UNIT] });
  });
});

describe("cashOutProblem: the Ripio address, checked before signing (spec, 9.2)", () => {
  it("takes a Ripio address as the app shows it, checksummed or in lowercase, with the spaces of a paste", () => {
    for (const text of [RIPIO, RIPIO.toLowerCase(), `  ${RIPIO} `, `${RIPIO}\n`]) expect(cashOutProblem(text, ours), JSON.stringify(text)).toBeNull();
  });

  it("refuses what isn't a Celo address, a checksummed one with a letter changed, and the zero address", () => {
    const tron = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
    const bitcoin = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    for (const text of ["", "0x1234", tron, bitcoin, MISTYPED, `0x${"0".repeat(40)}`]) {
      expect(cashOutProblem(text, ours), text).toBe("Esa dirección no parece válida. Copiala de nuevo desde Ripio.");
    }
  });

  it("refuses the member's own account, in any case", () => {
    for (const text of [ACCOUNT, ACCOUNT.toLowerCase()]) expect(cashOutProblem(text, ours), text).toBe("Esa es tu cuenta del fondo. Pegá la de Ripio.");
  });

  it("refuses the fund and the two tokens: they're TesorerIA's, not Ripio's", () => {
    for (const text of [FUND, WARS, USDT.toLowerCase()]) expect(cashOutProblem(text, ours), text).toBe("Esa dirección es de TesorerIA, no de Ripio.");
  });
});

describe("readCashOutAmount", () => {
  /** $ 45.000,005: the field shows it as $ 45.000,01. */
  const held = 45_000n * WARS_UNIT + 5n * 10n ** 15n;

  it("passes all the account holds, to its last unit, while the field is untouched", () => {
    expect(readCashOutAmount(null, held)).toEqual({ ok: true, amount: held });
  });

  it("passes what was typed, up to what the account holds", () => {
    expect(readCashOutAmount("2.000", held)).toEqual({ ok: true, amount: 2_000n * WARS_UNIT });
    expect(readCashOutAmount("$ 44.999,99", held)).toEqual({ ok: true, amount: 44_999n * WARS_UNIT + 99n * 10n ** 16n });
  });

  it("takes an amount typed as the field shows all of it as all of it, though the field rounded it", () => {
    expect(formatPesos(held)).toBe("$ 45.000,01");
    expect(readCashOutAmount("45.000,01", held)).toEqual({ ok: true, amount: held });
    const justUnder = 45_000n * WARS_UNIT + 4n * 10n ** 15n; // $ 45.000,004 shows as $ 45.000
    expect(readCashOutAmount("45.000", justUnder)).toEqual({ ok: true, amount: justUnder });
  });

  it("says what to fix: a malformed amount, nothing, or more than the account holds", () => {
    expect(readCashOutAmount("2,000.50", held)).toEqual({ ok: false, error: "Escribilo como 10.000 o 10.000,50." });
    expect(readCashOutAmount("0", held)).toEqual({ ok: false, error: "Escribilo como 10.000 o 10.000,50." });
    expect(readCashOutAmount("45.000,02", held)).toEqual({ ok: false, error: `Tenés ${formatPesos(held)} en tu cuenta.` });
  });

  it("has nothing to pass below half a cent, whatever was typed", () => {
    for (const speck of [0n, 5n * 10n ** 15n - 1n]) {
      expect(readCashOutAmount(null, speck)).toEqual({ ok: false, error: "No tenés pesos en tu cuenta para pasar." });
      expect(readCashOutAmount("1", speck)).toEqual({ ok: false, error: "No tenés pesos en tu cuenta para pasar." });
    }
    expect(readCashOutAmount(null, 5n * 10n ** 15n)).toEqual({ ok: true, amount: 5n * 10n ** 15n });
  });
});

describe("the Ripio address this browser remembers (spec, 9.2)", () => {
  const memory = () => {
    const items = new Map<string, string>();
    return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
  };

  it("remembers one per account, and gives it back checksummed", () => {
    const storage = memory();
    rememberRipioAddress(storage, ACCOUNT, RIPIO);
    expect(rememberedRipioAddress(storage, ACCOUNT)).toBe(RIPIO);
    expect(rememberedRipioAddress(storage, FUND)).toBeNull();
    storage.setItem(`tesoreria:ripio:${ACCOUNT.toLowerCase()}`, RIPIO.toLowerCase());
    expect(rememberedRipioAddress(storage, ACCOUNT)).toBe(RIPIO);
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
    expect(() => rememberRipioAddress(throwing, ACCOUNT, RIPIO)).not.toThrow();
    expect(rememberedRipioAddress(throwing, ACCOUNT)).toBeNull();
    expect(() => rememberRipioAddress(undefined, ACCOUNT, RIPIO)).not.toThrow();
    expect(rememberedRipioAddress(undefined, ACCOUNT)).toBeNull();
    const storage = memory();
    for (const junk of ["not an address", `0x${"0".repeat(40)}`, MISTYPED]) {
      storage.setItem(`tesoreria:ripio:${ACCOUNT.toLowerCase()}`, junk);
      expect(rememberedRipioAddress(storage, ACCOUNT), junk).toBeNull();
    }
  });
});
