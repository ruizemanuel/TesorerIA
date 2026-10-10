import { USDT, WARS } from "@tesoreria/agent";
import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  contributeCalls,
  defaultWarsAmount,
  fitUnderCap,
  pesosText,
  rampUrl,
  readPesosAmount,
  roomUnderCap,
  weeklyContribution,
} from "../src/lib/contribute";
import { DEFAULT_BALANCE_CAP, memberFundAbi } from "../src/lib/fund-abi";
import { NBSP, USDT_UNIT, WARS_UNIT, formatPesos } from "../src/lib/format";

const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const ME = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const pesos = (n: number) => BigInt(n) * WARS_UNIT;

describe("contributeCalls", () => {
  it("approves exactly the amount to the fund and contributes it, in one operation", () => {
    for (const [token, address, fn] of [
      ["usdt", USDT, "contributeUsdt"],
      ["wars", WARS, "contributeWars"],
    ] as const) {
      const [approve, contribute] = contributeCalls({ fund: FUND, token, amount: 10_000_000n });
      expect(approve?.to).toBe(address);
      expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data! })).toEqual({ functionName: "approve", args: [FUND, 10_000_000n] });
      expect(contribute?.to).toBe(FUND);
      expect(decodeFunctionData({ abi: memberFundAbi, data: contribute!.data! })).toEqual({ functionName: fn, args: [10_000_000n] });
    }
  });
});

describe("rampUrl", () => {
  it("opens Ripio's ramp for wARS on Celo, to the member's own account (spec, 10)", () => {
    expect(rampUrl(ME)).toBe(`https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&address=${ME}`);
  });

  it("carries the amount, in pesos as Ripio's form reads them", () => {
    expect(rampUrl(ME, pesos(10_000))).toBe(`https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=10000&address=${ME}`);
    expect(rampUrl(ME, pesos(10_000) + 50n * 10n ** 16n)).toContain("&amount=10000.5&");
  });
});

describe("what Aportar offers", () => {
  it("never offers the whole wARS balance: reimbursements land in the same account", () => {
    // A member who was just reimbursed $ 45.000 and owes $ 10.000 is offered the $ 10.000.
    expect(defaultWarsAmount({ held: pesos(45_000), owed: pesos(10_000), weeklyFee: pesos(10_000), room: null })).toBe(pesos(10_000));
  });

  it("offers the weekly fee when you owe nothing, and what you have when it is less", () => {
    expect(defaultWarsAmount({ held: pesos(45_000), owed: 0n, weeklyFee: pesos(10_000), room: null })).toBe(pesos(10_000));
    expect(defaultWarsAmount({ held: pesos(4_000), owed: pesos(10_000), weeklyFee: pesos(10_000), room: null })).toBe(pesos(4_000));
    expect(defaultWarsAmount({ held: 0n, owed: pesos(10_000), weeklyFee: pesos(10_000), room: null })).toBe(0n);
  });

  it("owes more than a fee: offers what is owed, so the arrears are paid", () => {
    expect(weeklyContribution({ owed: pesos(30_000), weeklyFee: pesos(10_000), room: null })).toBe(pesos(30_000));
  });

  it("keeps to the room left under the fund's cap", () => {
    expect(weeklyContribution({ owed: pesos(10_000), weeklyFee: pesos(10_000), room: pesos(3_000) })).toBe(pesos(3_000));
    expect(defaultWarsAmount({ held: pesos(45_000), owed: pesos(10_000), weeklyFee: pesos(10_000), room: 0n })).toBe(0n);
  });
});

describe("the fund's cap", () => {
  it("is $ 450.000 by default, and the room is what is left of it", () => {
    expect(formatPesos(DEFAULT_BALANCE_CAP)).toBe(`$${NBSP}450.000`);
    expect(roomUnderCap(pesos(440_000))).toBe(pesos(10_000));
    expect(roomUnderCap(DEFAULT_BALANCE_CAP)).toBe(0n);
    expect(roomUnderCap(DEFAULT_BALANCE_CAP + 1n)).toBe(0n);
  });

  it("fits what you hold under the room, in the token's own units", () => {
    // wARS is worth itself.
    expect(fitUnderCap(pesos(45_000), pesos(45_000), pesos(10_000))).toBe(pesos(10_000));
    expect(fitUnderCap(pesos(5_000), pesos(5_000), pesos(10_000))).toBe(pesos(5_000));
    // 10 USDT worth $ 14.000: a room of $ 7.000 takes half of them.
    expect(fitUnderCap(10n * USDT_UNIT, pesos(14_000), pesos(7_000))).toBe(5n * USDT_UNIT);
    expect(fitUnderCap(10n * USDT_UNIT, pesos(14_000), pesos(14_000))).toBe(10n * USDT_UNIT);
    // No room known, or no worth known: nothing to fit against.
    expect(fitUnderCap(10n * USDT_UNIT, pesos(14_000), null)).toBe(10n * USDT_UNIT);
    expect(fitUnderCap(10n * USDT_UNIT, null, pesos(7_000))).toBe(10n * USDT_UNIT);
    expect(fitUnderCap(10n * USDT_UNIT, pesos(14_000), 0n)).toBe(0n);
  });
});

describe("readPesosAmount", () => {
  const held = pesos(45_000);

  it("reads what people write in Argentina", () => {
    expect(readPesosAmount("10.000", { held, room: null })).toEqual({ ok: true, amount: pesos(10_000) });
    expect(readPesosAmount("$ 10.000,50", { held, room: null })).toEqual({ ok: true, amount: pesos(10_000) + 50n * 10n ** 16n });
  });

  it("round-trips the amount it shows in the field", () => {
    for (const amount of [pesos(10_000), pesos(10_000) + 50n * 10n ** 16n, pesos(1)]) {
      expect(readPesosAmount(pesosText(amount), { held, room: null })).toEqual({ ok: true, amount });
    }
    expect(pesosText(pesos(10_000))).toBe("10.000");
  });

  it("teaches the format when it can't tell what was meant", () => {
    for (const bad of ["abc", "", "10.5", "10,000.50", "0"]) {
      expect(readPesosAmount(bad, { held, room: null }), bad).toEqual({ ok: false, error: "Escribilo como 10.000 o 10.000,50." });
    }
  });

  it("refuses an absurd amount before anything is encoded", () => {
    const result = readPesosAmount("1.000.000.000.001", { held: 10n ** 40n, room: null });
    expect(result).toEqual({ ok: false, error: `No puede pasar de ${formatPesos(1_000_000_000_000n * WARS_UNIT)}.` });
    expect(readPesosAmount("1.000.000.000.000", { held: 10n ** 40n, room: null }).ok).toBe(true);
  });

  it("refuses more than you have, and more than fits in the fund", () => {
    expect(readPesosAmount("45.001", { held, room: null })).toEqual({ ok: false, error: `En tu cuenta tenés ${formatPesos(held)}.` });
    expect(readPesosAmount("45.000", { held, room: pesos(10_000) })).toEqual({
      ok: false,
      error: `Al fondo le entran hasta ${formatPesos(pesos(10_000))} más, porque tiene un tope de ${formatPesos(DEFAULT_BALANCE_CAP)}.`,
    });
    expect(readPesosAmount("10.000", { held, room: pesos(10_000) }).ok).toBe(true);
    expect(readPesosAmount("1", { held, room: 0n })).toEqual({
      ok: false,
      error: `El fondo llegó a su tope de ${formatPesos(DEFAULT_BALANCE_CAP)}: no entra más.`,
    });
  });
});
