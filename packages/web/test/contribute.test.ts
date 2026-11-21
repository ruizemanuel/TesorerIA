import { CURRENCIES, USDT, WARS, currencyOf, fundV2Abi } from "@tesoreria/agent";
import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  USDT_MARGIN_BPS,
  contributeCalls,
  defaultUsdtAmount,
  defaultWarsAmount,
  fitUnderCap,
  nextRate,
  moneyText,
  rampUrl,
  readPesosAmount,
  readUsdtAmount,
  roomUnderCap,
  usdtFor,
  usdtText,
  usdtToSend,
  usdtWorth,
  usdtWorthText,
  warsField,
  weeklyContribution,
  withFee,
} from "../src/lib/contribute";
import { COUNTRIES } from "../src/lib/countries";
import { memberFundAbi } from "../src/lib/fund-abi";
import { buildFundView } from "../src/lib/fund-view";
import { NBSP, USDT_UNIT, WARS_UNIT, formatMoney, upToCentavo } from "../src/lib/format";
import { snapshot } from "./support/fixtures";
import { en, es } from "./support/messages";

const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const ME = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const pesos = (n: number) => BigInt(n) * WARS_UNIT;
/** The cap on its balance every fund in wARS gets: wARS's, in the agent's table. */
const BALANCE_CAP = pesos(450_000);

describe("contributeCalls", () => {
  it("approves exactly the amount to the fund and contributes it, in one operation", () => {
    for (const [token, address, fn] of [
      ["usdt", USDT, "contributeUsdt"],
      ["wars", WARS, "contributeWars"],
    ] as const) {
      const [approve, contribute] = contributeCalls({ fund: FUND, version: 1, token, amount: 10_000_000n, currency: WARS, dollar: USDT });
      expect(approve?.to).toBe(address);
      expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data! })).toEqual({ functionName: "approve", args: [FUND, 10_000_000n] });
      expect(contribute?.to).toBe(FUND);
      expect(decodeFunctionData({ abi: memberFundAbi, data: contribute!.data! })).toEqual({ functionName: fn, args: [10_000_000n] });
    }
  });
});

describe("rampUrl", () => {
  const wars = currencyOf(WARS)!;
  const wmxn = currencyOf(COUNTRIES.MX.currency.token)!;

  it("opens Ripio's ramp for wARS on Celo, to the member's own account (spec, 10)", () => {
    expect(rampUrl(ME, wars)).toBe(`https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&address=${ME}`);
  });

  it("carries the amount, in pesos as Ripio's form reads them", () => {
    expect(rampUrl(ME, wars, pesos(10_000))).toBe(`https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=10000&address=${ME}`);
    expect(rampUrl(ME, wars, pesos(10_000) + 50n * 10n ** 16n)).toContain("&amount=10000.5&");
  });

  it("sends a Mexican fund to Ripio's ramp for Mexico and wMXN", () => {
    expect(rampUrl(ME, wmxn, (100_25n * WARS_UNIT) / 100n)).toBe(`https://ramp.ripio.com/?country=MX&chain=42220&token=WMXN&amount=100.25&address=${ME}`);
    expect(rampUrl(ME, wmxn)).toBe(`https://ramp.ripio.com/?country=MX&chain=42220&token=WMXN&address=${ME}`);
    expect(rampUrl(ME, wars, 10_000n * WARS_UNIT)).toBe(`https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=10000&address=${ME}`); // today's value
  });

  it("has no ramp for a currency Ripio's ramp doesn't serve, rather than a link to a token called null", () => {
    const wpen = CURRENCIES.find((currency) => currency.symbol === "wPEN")!;
    expect(wpen.rampToken).toBeNull();
    expect(() => rampUrl(ME, wpen)).toThrow("wPEN");
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
    expect(formatMoney(BALANCE_CAP, es)).toBe(`$${NBSP}450.000`);
    expect(roomUnderCap(pesos(440_000), BALANCE_CAP, 0)).toBe(pesos(10_000));
    expect(roomUnderCap(BALANCE_CAP, BALANCE_CAP, 0)).toBe(0n);
    expect(roomUnderCap(BALANCE_CAP + 1n, BALANCE_CAP, 0)).toBe(0n);
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
    expect(readPesosAmount("10.000", { held, room: null, cap: BALANCE_CAP }, es)).toEqual({ ok: true, amount: pesos(10_000) });
    expect(readPesosAmount("$ 10.000,50", { held, room: null, cap: BALANCE_CAP }, es)).toEqual({ ok: true, amount: pesos(10_000) + 50n * 10n ** 16n });
  });

  it("round-trips the amount it shows in the field", () => {
    for (const amount of [pesos(10_000), pesos(10_000) + 50n * 10n ** 16n, pesos(1)]) {
      expect(readPesosAmount(moneyText(amount, es), { held, room: null, cap: BALANCE_CAP }, es)).toEqual({ ok: true, amount });
    }
    expect(moneyText(pesos(10_000), es)).toBe("10.000");
  });

  it("teaches the format when it can't tell what was meant", () => {
    for (const bad of ["abc", "", "10.5", "10,000.50", "0"]) {
      expect(readPesosAmount(bad, { held, room: null, cap: BALANCE_CAP }, es), bad).toEqual({ ok: false, error: "Escribilo como 10.000 o 10.000,50." });
    }
  });

  it("refuses an absurd amount before anything is encoded", () => {
    const result = readPesosAmount("1.000.000.000.001", { held: 10n ** 40n, room: null, cap: BALANCE_CAP }, es);
    expect(result).toEqual({ ok: false, error: `No puede pasar de ${formatMoney(1_000_000_000_000n * WARS_UNIT, es)}.` });
    expect(readPesosAmount("1.000.000.000.000", { held: 10n ** 40n, room: null, cap: BALANCE_CAP }, es).ok).toBe(true);
  });

  it("refuses more than you have, and more than fits in the fund", () => {
    expect(readPesosAmount("45.001", { held, room: null, cap: BALANCE_CAP }, es)).toEqual({ ok: false, error: `En tu cuenta tenés ${formatMoney(held, es)}.` });
    expect(readPesosAmount("45.000", { held, room: pesos(10_000), cap: BALANCE_CAP }, es)).toEqual({
      ok: false,
      error: `Al fondo le entran hasta ${formatMoney(pesos(10_000), es)} más, porque tiene un tope de ${formatMoney(BALANCE_CAP, es)}.`,
    });
    expect(readPesosAmount("10.000", { held, room: pesos(10_000), cap: BALANCE_CAP }, es).ok).toBe(true);
    expect(readPesosAmount("1", { held, room: 0n, cap: BALANCE_CAP }, es)).toEqual({
      ok: false,
      error: `El fondo llegó a su tope de ${formatMoney(BALANCE_CAP, es)}: no entra más.`,
    });
  });
});

describe("Aportar in USDT: what covers the week, at the fund's rate", () => {
  const rate = 1_600n * WARS_UNIT; // what one USDT is worth to the fund (quoteUsdtInWars of 1 USDT)
  const usdt = (n: number) => BigInt(Math.round(n * 100)) * 10_000n; // n USDT, to the cent
  const week = { owed: 0n, weeklyFee: pesos(10_000), room: pesos(400_000) };

  it("asks for 0,3 % more than the pesos, rounded up to a USDT cent", () => {
    expect(USDT_MARGIN_BPS).toBe(30n);
    expect(usdtFor(pesos(10_000), rate)).toBe(usdt(6.27)); // 10.030 / 1.600 = 6,26875
    expect(usdtFor(pesos(16_000), rate)).toBe(usdt(10.03)); // 16.048 / 1.600 = 10,03 exactly: not a cent more
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
    expect(defaultUsdtAmount({ held: usdt(20), rate, ...week })).toBe(usdt(6.27));
    expect(defaultUsdtAmount({ held: usdt(5), rate, ...week })).toBe(usdt(5));
    expect(defaultUsdtAmount({ held: usdt(20), rate, ...week, owed: pesos(15_000) })).toBe(usdt(9.41)); // 15.045 / 1.600 = 9,403…
    // $ 5.000 left under the cap: the margin can't take it over (20 USDT are $ 32.000; 5.000 of them, 3,125 USDT).
    // What fits is offered to the cent below, 3,12: the field shows what is sent, and a cent is left to spare.
    expect(defaultUsdtAmount({ held: usdt(20), rate, ...week, room: pesos(5_000) })).toBe(3_120_000n);
    expect(defaultUsdtAmount({ held: usdt(20), rate: null, ...week })).toBe(usdt(20)); // no rate: all of it, as before
  });

  it("offers, under the cap, an amount the field shows as it is and the cap still takes with a cent to spare", () => {
    const capped = { held: usdt(20), rate, ...week, room: pesos(5_000), cap: BALANCE_CAP };
    const offered = defaultUsdtAmount(capped);
    expect(offered % 10_000n).toBe(0n); // on the cent grid: "3,12" is what is sent
    expect(readUsdtAmount(usdtText(offered, es), capped, es)).toEqual({ ok: true, amount: offered }); // and what the field says reads back
    expect(usdtWorth(offered, rate)).toBeLessThan(pesos(5_000)); // below the room: a rate uptick has a cent to cover
    // Where the cap doesn't bind it changes nothing: all you hold when it's less than the week, even to a fraction of a cent.
    expect(defaultUsdtAmount({ held: 5_126_000n, rate, ...week })).toBe(5_126_000n);
    expect(defaultUsdtAmount({ held: 5_126_000n, rate, ...week, room: pesos(400_000) })).toBe(5_126_000n);
    // Or the week itself when that is less than what fits.
    expect(defaultUsdtAmount({ held: usdt(20), rate, ...week, weeklyFee: pesos(1_000), room: pesos(5_000) })).toBe(usdt(0.63)); // 1.003 / 1.600 = 0,6268…
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
    expect(usdtToSend({ held: 0n, rate, ...week })).toBe(usdt(6.27));
    expect(usdtToSend({ held: usdt(5), rate, ...week })).toBe(usdt(1.27));
    expect(usdtToSend({ held: 6_265_000n, rate, ...week })).toBe(usdt(0.01));
    expect(usdtToSend({ held: usdt(7), rate, ...week })).toBe(0n);
    expect(usdtToSend({ held: 0n, rate: null, ...week })).toBeNull();
  });

  it("reads the USDT typed, and says what to fix", () => {
    const mine = { held: usdt(20), rate, room: pesos(400_000), cap: BALANCE_CAP };
    expect(readUsdtAmount("10", mine, es)).toEqual({ ok: true, amount: usdt(10) });
    expect(readUsdtAmount("6,26", mine, es)).toEqual({ ok: true, amount: usdt(6.26) });
    expect(readUsdtAmount(usdtText(usdt(6.26), es), mine, es)).toEqual({ ok: true, amount: usdt(6.26) }); // round-trips the field
    expect(readUsdtAmount("6.26", mine, es)).toEqual({ ok: false, error: "Escribilo como 6 o 6,25." });
    expect(readUsdtAmount("21", mine, es)).toEqual({ ok: false, error: `En tu cuenta tenés 20${NBSP}USDT.` });
    const cap = formatMoney(BALANCE_CAP, es);
    expect(readUsdtAmount("10", { ...mine, room: pesos(8_000) }, es)).toEqual({
      ok: false,
      error: `Al fondo le entran hasta 5${NBSP}USDT más, porque tiene un tope de ${cap}.`,
    });
    expect(readUsdtAmount("1", { ...mine, room: 0n }, es)).toEqual({ ok: false, error: `El fondo llegó a su tope de ${cap}: no entra más.` });
  });

  it("says under the field that it covers the week, or what it comes to", () => {
    expect(usdtWorthText(usdt(6.26), rate, pesos(10_000), es)).toBe(`Cubre los ${formatMoney(pesos(10_000), es)}, al precio de ahora.`);
    expect(usdtWorthText(usdt(10), rate, pesos(10_000), es)).toBe(`Son unos ${formatMoney(pesos(16_000), es)} al precio de ahora.`);
    expect(usdtWorthText(usdt(5), rate, pesos(10_000), es)).toBe(`Son unos ${formatMoney(pesos(8_000), es)} al precio de ahora.`);
  });
});

describe("what Aportar reads and writes in English", () => {
  const held = pesos(20_000);

  it("reads and writes the field's amount in English", () => {
    expect(moneyText(10_000n * WARS_UNIT, en)).toBe("10,000");
    expect(usdtText(6_260_000n, en)).toBe("6.26");
    expect(readPesosAmount("10,000", { held: 20_000n * WARS_UNIT, room: null, cap: BALANCE_CAP }, en)).toEqual({ ok: true, amount: 10_000n * WARS_UNIT });
    expect(readPesosAmount("10.000", { held: 20_000n * WARS_UNIT, room: null, cap: BALANCE_CAP }, en)).toEqual({
      ok: false,
      error: "Write it like 10,000 or 10,000.50.",
    });
    expect(readPesosAmount("30,000", { held: 20_000n * WARS_UNIT, room: null, cap: BALANCE_CAP }, en)).toEqual({
      ok: false,
      error: `Your account holds ARS${NBSP}20,000.`,
    });
  });

  it("round-trips what the field shows, in both languages", () => {
    for (const m of [es, en]) {
      for (const amount of [pesos(10_000), pesos(10_000) + 50n * 10n ** 16n, pesos(1)]) {
        expect(readPesosAmount(moneyText(amount, m), { held, room: null, cap: BALANCE_CAP }, m)).toEqual({ ok: true, amount });
      }
    }
    expect(moneyText(pesos(10_000) + 50n * 10n ** 16n, en)).toBe("10,000.50");
  });

  it("refuses an absurd amount, more than you have and more than fits, with the language's own amounts", () => {
    expect(readPesosAmount("1,000,000,000,001", { held: 10n ** 40n, room: null, cap: BALANCE_CAP }, en)).toEqual({
      ok: false,
      error: `It can't be more than ARS${NBSP}1,000,000,000,000.`,
    });
    const cap = `ARS${NBSP}450,000`;
    expect(readPesosAmount("20,000", { held, room: pesos(10_000), cap: BALANCE_CAP }, en)).toEqual({
      ok: false,
      error: `The fund has room for up to ARS${NBSP}10,000 more, because its cap is ${cap}.`,
    });
    expect(readPesosAmount("1", { held, room: 0n, cap: BALANCE_CAP }, en)).toEqual({ ok: false, error: `The fund reached its cap of ${cap}: no more fits.` });
  });

  it("reads the USDT typed the way English writes it, and says what to fix", () => {
    const rate = 1_600n * WARS_UNIT;
    const mine = { held: 20_000_000n, rate, room: pesos(400_000), cap: BALANCE_CAP };
    expect(readUsdtAmount("6.26", mine, en)).toEqual({ ok: true, amount: 6_260_000n });
    expect(readUsdtAmount(usdtText(6_260_000n, en), mine, en)).toEqual({ ok: true, amount: 6_260_000n });
    expect(readUsdtAmount("6,26", mine, en)).toEqual({ ok: false, error: "Write it like 6 or 6.25." });
    expect(readUsdtAmount("21", mine, en)).toEqual({ ok: false, error: `Your account holds 20${NBSP}USDT.` });
    expect(readUsdtAmount("10", { ...mine, room: pesos(8_000) }, en)).toEqual({
      ok: false,
      error: `The fund has room for up to 5${NBSP}USDT more, because its cap is ARS${NBSP}450,000.`,
    });
  });

  it("says under the field that it covers the week, or what it comes to, in English", () => {
    const rate = 1_600n * WARS_UNIT;
    expect(usdtWorthText(6_260_000n, rate, pesos(10_000), en)).toBe(`That covers ARS${NBSP}10,000 at the current price.`);
    expect(usdtWorthText(10_000_000n, rate, pesos(10_000), en)).toBe(`That comes to about ARS${NBSP}16,000 at the current price.`);
  });
});

describe("Aportar in a v2 fund", () => {
  const rate = 1_600n * WARS_UNIT; // what one USDT is worth to the fund (quoteDollar of 1 USDT)
  const week = { owed: 0n, weeklyFee: pesos(10_000), room: pesos(400_000) };

  it("a v2 fund asks what credits the whole fee", () => {
    const x = withFee(pesos(10_000), 25);
    expect(x).toBe(10_025_062_656_641_604_010_026n);
    // FundV2.contribute credits what arrives less its fee, rounded down: the week whole, or a wei more.
    const credited = x - (x * 25n) / 10_000n;
    expect([pesos(10_000), pesos(10_000) + 1n]).toContain(credited);
    expect(moneyText(upToCentavo(x), es)).toBe("10.025,07");
    expect(moneyText(upToCentavo(x), en)).toBe("10,025.07");
    // The pesos tab offers it, within what the account holds and what fits under the cap.
    expect(defaultWarsAmount({ held: pesos(45_000), ...week, feeBps: 25 })).toBe(x);
    expect(defaultWarsAmount({ held: pesos(10_020), ...week, feeBps: 25 })).toBe(pesos(10_020));
    expect(defaultWarsAmount({ held: pesos(45_000), ...week, room: pesos(5_000), feeBps: 25 })).toBe(pesos(5_000));
    // Without a fee it is the week itself.
    expect(withFee(pesos(10_000), 0)).toBe(pesos(10_000));
    expect(defaultWarsAmount({ held: pesos(45_000), ...week, feeBps: 0 })).toBe(pesos(10_000));
  });

  it("an untouched field sends the exact amount, not the rounded one it shows", () => {
    const x = withFee(pesos(10_000), 25);
    const offer = { held: pesos(45_000), ...week, feeBps: 25 };
    expect(warsField(null, offer, 2, BALANCE_CAP, es)).toEqual({ value: "10.025,07", reading: { ok: true, amount: x } });
    expect(warsField(null, offer, 2, BALANCE_CAP, en)).toEqual({ value: "10,025.07", reading: { ok: true, amount: x } });
    // What the field shows is a fraction of a centavo over it: typed, that is what goes.
    expect(warsField("10.025,07", offer, 2, BALANCE_CAP, es)).toEqual({
      value: "10.025,07",
      reading: { ok: true, amount: pesos(10_025) + 7n * 10n ** 16n },
    });
    expect(warsField("10.025", offer, 2, BALANCE_CAP, es).reading).toEqual({ ok: true, amount: pesos(10_025) });
    expect(warsField("50.000", offer, 2, BALANCE_CAP, es).reading).toEqual({
      ok: false,
      error: `En tu cuenta tenés ${formatMoney(pesos(45_000), es)}.`,
    });
    // A version 1 fund sends what its field shows, as it always did.
    const owed = pesos(9_940) + 123n * 10n ** 15n;
    expect(warsField(null, { ...offer, owed, feeBps: 0 }, 1, BALANCE_CAP, es)).toEqual({
      value: "9.940,12",
      reading: { ok: true, amount: pesos(9_940) + 12n * 10n ** 16n },
    });
  });

  it("rounds a default the cap or the account limits down, so the field shows what goes and takes it back", () => {
    // Up to the centavo is only for the fee's amount: what fits under the cap, or what the account holds, goes down to it.
    const room = roomUnderCap(pesos(100_020), BALANCE_CAP, 25); // $ 350.857,142857…
    const capped = { held: pesos(450_000), owed: 0n, weeklyFee: pesos(400_000), room, feeBps: 25 };
    const fits = pesos(350_857) + 14n * 10n ** 16n;
    expect(warsField(null, capped, 2, BALANCE_CAP, es)).toEqual({ value: "350.857,14", reading: { ok: true, amount: fits } });
    expect(warsField("350.857,14", capped, 2, BALANCE_CAP, es).reading).toEqual({ ok: true, amount: fits });
    for (const held of [pesos(5_000) + 4n * 10n ** 15n, pesos(5_000) + 6n * 10n ** 15n]) {
      const short = { held, ...week, feeBps: 25 };
      expect(warsField(null, short, 2, BALANCE_CAP, es)).toEqual({ value: "5.000", reading: { ok: true, amount: pesos(5_000) } });
    }
    // An account that holds exactly the fee's amount still sends it whole.
    const exact = withFee(pesos(10_000), 25);
    expect(warsField(null, { held: exact, ...week, feeBps: 25 }, 2, BALANCE_CAP, es)).toEqual({ value: "10.025,07", reading: { ok: true, amount: exact } });
  });

  it("a pesos default bound by the cap fits the contract's own count, with several members' dollars pending", () => {
    // Ana's and Beto's dollars are worth 1,5 wei each: each one's value floors to 1, and the contract floors their sum once,
    // to 3. With $ 400.000 less 2 wei available, the contract counts $ 400.000 and a wei; the sum of the parts, a wei less.
    const available = pesos(400_000) - 2n;
    const view = buildFundView({
      snapshot: snapshot({
        version: 2,
        feeBps: 0,
        currencyBalance: available,
        pendingDollar: [1n, 1n, 0n],
        pendingValue: [1n, 1n, 0n],
        totalPendingDollar: 2n,
        dollarBalance: 2n,
      }),
      name: "Fútbol de los jueves",
      agreedExpense: "la cancha",
      balance: available + 3n,
      weeklyFee: pesos(10_000),
      joined: new Map(),
      names: new Map(),
      viewer: null,
      m: es,
    });
    const contractCounts = available + 3n;
    expect(view.counted).toBe(contractCounts);
    const room = roomUnderCap(view.counted, view.balanceCap, 0);
    const offer = { held: pesos(450_000), owed: pesos(60_000), weeklyFee: pesos(10_000), room, feeBps: 0 };
    const sent = warsField(null, offer, 2, view.balanceCap, es).reading;
    expect(sent.ok && contractCounts + sent.amount <= view.balanceCap).toBe(true);
  });

  it("in USDT, the margin covers the conversion and the fee once", () => {
    const offer = { held: 20n * USDT_UNIT, rate, ...week, feeBps: 25 };
    expect(defaultUsdtAmount(offer)).toBe(usdtFor(pesos(10_000), rate, 55n));
    expect(defaultUsdtAmount(offer)).toBe(6_290_000n); // 10.055 / 1.600 = 6,284…
    expect(usdtFor(withFee(pesos(10_000), 25), rate, 55n)).toBe(6_310_000n); // the fee twice: not what is asked
    expect(usdtToSend({ ...offer, held: 0n })).toBe(6_290_000n);
    expect(usdtToSend({ ...offer, held: 5n * USDT_UNIT })).toBe(1_290_000n);
    // What it says under the field is about the week, net of the fee.
    expect(usdtWorthText(6_290_000n, rate, pesos(10_000), es)).toBe(`Cubre los ${formatMoney(pesos(10_000), es)}, al precio de ahora.`);
    // Without a fee, the margin of a v1 fund.
    expect(defaultUsdtAmount({ ...offer, feeBps: 0 })).toBe(usdtFor(pesos(10_000), rate));
  });

  it("contributeCalls for a v2 fund approves its currency or dollar and calls contribute or contributeDollar", () => {
    const WBRL = getAddress("0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0");
    for (const [token, currency, dollar, asset, fn] of [
      ["wars", WARS, USDT, WARS, "contribute"],
      ["usdt", WARS, USDT, USDT, "contributeDollar"],
      ["wars", WBRL, null, WBRL, "contribute"],
    ] as const) {
      const [approve, contribute] = contributeCalls({ fund: FUND, version: 2, token, amount: 10_000_000n, currency, dollar });
      expect(approve?.to).toBe(asset);
      expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data! })).toEqual({ functionName: "approve", args: [FUND, 10_000_000n] });
      expect(contribute?.to).toBe(FUND);
      expect(decodeFunctionData({ abi: fundV2Abi, data: contribute!.data! })).toEqual({ functionName: fn, args: [10_000_000n] });
    }
    // A fund with no dollar takes none.
    expect(() => contributeCalls({ fund: FUND, version: 2, token: "usdt", amount: 1n, currency: WBRL, dollar: null })).toThrow();
  });

  it("the room under a v2 fund's cap leaves out dollars sent to it directly", () => {
    // Caro's 6 USDT wait for the agent, worth $ 10.020; `stray` more reached the fund without contributeDollar.
    const view = (stray: bigint) =>
      buildFundView({
        snapshot: snapshot({
          version: 2,
          feeBps: 25,
          pendingDollar: [0n, 0n, 6n * USDT_UNIT],
          pendingValue: [0n, 0n, pesos(10_020)],
          totalPendingDollar: 6n * USDT_UNIT,
          dollarBalance: 6n * USDT_UNIT + stray,
        }),
        name: "Fútbol de los jueves",
        agreedExpense: "la cancha",
        balance: pesos(90_000) + pesos(10_020) + usdtWorth(stray, rate),
        weeklyFee: pesos(10_000),
        joined: new Map(),
        names: new Map(),
        viewer: null,
        m: es,
      });
    // 300 USDT of nobody's: $ 480.000, over the cap on their own, and the room doesn't shrink.
    const withStray = view(300n * USDT_UNIT);
    expect(withStray.balance).toBe(pesos(580_020));
    expect(withStray.counted).toBe(pesos(100_020));
    expect(view(0n).counted).toBe(pesos(100_020));
    expect([withStray.version, withStray.feeBps, withStray.balanceCap]).toEqual([2, 25, BALANCE_CAP]);
    // In pesos, what goes in before the fee: (450.000 − 100.020) × 10.000 / 9.975, down; its fee leaves the cap whole.
    const room = roomUnderCap(withStray.counted, withStray.balanceCap, withStray.feeBps);
    expect(room).toBe(350_857_142_857_142_857_142_857n);
    expect(withStray.counted + room - (room * 25n) / 10_000n).toBeLessThanOrEqual(withStray.balanceCap);
    // In USDT, their value at the fund's rate: the contract counts pending dollars whole.
    expect(roomUnderCap(withStray.counted, withStray.balanceCap, 0)).toBe(pesos(349_980));
    // A v1 fund counts its whole balance, as before.
    const v1 = buildFundView({
      snapshot: snapshot(),
      name: "Fútbol de los jueves",
      agreedExpense: "la cancha",
      balance: pesos(87_500),
      weeklyFee: pesos(10_000),
      joined: new Map(),
      names: new Map(),
      viewer: null,
      m: es,
    });
    expect([v1.version, v1.counted, v1.feeBps, v1.balanceCap, v1.currency, v1.dollar]).toEqual([1, pesos(87_500), 0, BALANCE_CAP, WARS, USDT]);
  });
});
