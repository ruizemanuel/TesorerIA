import { USDT, WARS } from "@tesoreria/agent";
import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  USDT_MARGIN_BPS,
  contributeCalls,
  defaultUsdtAmount,
  defaultWarsAmount,
  fitUnderCap,
  nextRate,
  pesosText,
  rampUrl,
  readPesosAmount,
  readUsdtAmount,
  roomUnderCap,
  usdtFor,
  usdtText,
  usdtToSend,
  usdtWorth,
  usdtWorthText,
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

describe("Aportar in USDT: what covers the week, at the fund's rate", () => {
  const rate = 1_600n * WARS_UNIT; // what one USDT is worth to the fund (quoteUsdtInWars of 1 USDT)
  const usdt = (n: number) => BigInt(Math.round(n * 100)) * 10_000n; // n USDT, to the cent
  const week = { owed: 0n, weeklyFee: pesos(10_000), room: pesos(400_000) };

  it("asks for 0,1 % more than the pesos, rounded up to a USDT cent", () => {
    expect(USDT_MARGIN_BPS).toBe(10n);
    expect(usdtFor(pesos(10_000), rate)).toBe(usdt(6.26)); // 10.010 / 1.600 = 6,25625
    expect(usdtFor(pesos(16_000), rate)).toBe(usdt(10.01)); // 16.016 / 1.600 = 10,01 exactly: not a cent more
    const cases = [
      [pesos(10_000), 1_606_846_000_000_000_000_000n],
      [pesos(7), 1_234_567_890_123_456_789_012n],
      [pesos(450_000), rate],
    ] as const;
    for (const [amount, r] of cases) {
      const withMargin = amount + (amount * USDT_MARGIN_BPS) / 10_000n;
      const worth = usdtWorth(usdtFor(amount, r), r);
      expect(worth).toBeGreaterThanOrEqual(withMargin);
      expect(worth).toBeLessThanOrEqual(withMargin + usdtWorth(10_000n, r) + 1n); // at most a cent over
    }
  });

  it("offers what covers the week, like the pesos' tab, or all you hold when it's less; never over the cap", () => {
    expect(defaultUsdtAmount({ held: usdt(20), rate, ...week })).toBe(usdt(6.26));
    expect(defaultUsdtAmount({ held: usdt(5), rate, ...week })).toBe(usdt(5));
    expect(defaultUsdtAmount({ held: usdt(20), rate, ...week, owed: pesos(15_000) })).toBe(usdt(9.39)); // 15.015 / 1.600 = 9,384…
    // $ 5.000 left under the cap: the margin can't take it over (20 USDT are $ 32.000; 5.000 of them, 3,125 USDT).
    // What fits is offered to the cent below, 3,12: the field shows what is sent, and a cent is left to spare.
    expect(defaultUsdtAmount({ held: usdt(20), rate, ...week, room: pesos(5_000) })).toBe(3_120_000n);
    expect(defaultUsdtAmount({ held: usdt(20), rate: null, ...week })).toBe(usdt(20)); // no rate: all of it, as before
  });

  it("offers, under the cap, an amount the field shows as it is and the cap still takes with a cent to spare", () => {
    const capped = { held: usdt(20), rate, ...week, room: pesos(5_000) };
    const offered = defaultUsdtAmount(capped);
    expect(offered % 10_000n).toBe(0n); // on the cent grid: "3,12" is what is sent
    expect(readUsdtAmount(usdtText(offered), capped)).toEqual({ ok: true, amount: offered }); // and what the field says reads back
    expect(usdtWorth(offered, rate)).toBeLessThan(pesos(5_000)); // below the room: a rate uptick has a cent to cover
    // Where the cap doesn't bind it changes nothing: all you hold when it's less than the week, even to a fraction of a cent.
    expect(defaultUsdtAmount({ held: 5_126_000n, rate, ...week })).toBe(5_126_000n);
    expect(defaultUsdtAmount({ held: 5_126_000n, rate, ...week, room: pesos(400_000) })).toBe(5_126_000n);
    // Or the week itself when that is less than what fits.
    expect(defaultUsdtAmount({ held: usdt(20), rate, ...week, weeklyFee: pesos(1_000), room: pesos(5_000) })).toBe(usdt(0.63)); // 1.001 / 1.600 = 0,6256…
  });

  it("keeps the last rate when reading it again fails, and takes no rate from a zero", () => {
    const fresh = 1_650n * WARS_UNIT;
    expect(nextRate(rate, fresh)).toBe(fresh); // a fresh read wins
    expect(nextRate(null, fresh)).toBe(fresh);
    expect(nextRate(rate, null)).toBe(rate); // the read failed: the last good one stays
    expect(nextRate(rate, 0n)).toBe(rate); // a zero isn't a price: it's a failed read too
    expect(nextRate(null, null)).toBeNull(); // none read yet: no rate
    expect(nextRate(null, 0n)).toBeNull();
  });

  it("says how much more to send for the week, to the cent up, and nothing once it's there", () => {
    expect(usdtToSend({ held: 0n, rate, ...week })).toBe(usdt(6.26));
    expect(usdtToSend({ held: usdt(5), rate, ...week })).toBe(usdt(1.26));
    expect(usdtToSend({ held: 6_255_000n, rate, ...week })).toBe(usdt(0.01));
    expect(usdtToSend({ held: usdt(7), rate, ...week })).toBe(0n);
    expect(usdtToSend({ held: 0n, rate: null, ...week })).toBeNull();
  });

  it("reads the USDT typed, and says what to fix", () => {
    const mine = { held: usdt(20), rate, room: pesos(400_000) };
    expect(readUsdtAmount("10", mine)).toEqual({ ok: true, amount: usdt(10) });
    expect(readUsdtAmount("6,26", mine)).toEqual({ ok: true, amount: usdt(6.26) });
    expect(readUsdtAmount(usdtText(usdt(6.26)), mine)).toEqual({ ok: true, amount: usdt(6.26) }); // round-trips the field
    expect(readUsdtAmount("6.26", mine)).toEqual({ ok: false, error: "Escribilo como 6 o 6,25." });
    expect(readUsdtAmount("21", mine)).toEqual({ ok: false, error: `En tu cuenta tenés 20${NBSP}USDT.` });
    const cap = formatPesos(DEFAULT_BALANCE_CAP);
    expect(readUsdtAmount("10", { ...mine, room: pesos(8_000) })).toEqual({
      ok: false,
      error: `Al fondo le entran hasta 5${NBSP}USDT más, porque tiene un tope de ${cap}.`,
    });
    expect(readUsdtAmount("1", { ...mine, room: 0n })).toEqual({ ok: false, error: `El fondo llegó a su tope de ${cap}: no entra más.` });
  });

  it("says under the field that it covers the week, or what it comes to", () => {
    expect(usdtWorthText(usdt(6.26), rate, pesos(10_000))).toBe(`Cubre los ${formatPesos(pesos(10_000))}, al precio de ahora.`);
    expect(usdtWorthText(usdt(10), rate, pesos(10_000))).toBe(`Son unos ${formatPesos(pesos(16_000))} al precio de ahora.`);
    expect(usdtWorthText(usdt(5), rate, pesos(10_000))).toBe(`Son unos ${formatPesos(pesos(8_000))} al precio de ahora.`);
  });
});
