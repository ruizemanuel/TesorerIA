import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  FACTORIES,
  FEE_RECIPIENT,
  FUND_FACTORY,
  FUND_FACTORY_BLOCK,
  FUND_FACTORY_V2,
  FUND_FACTORY_V2_BLOCK,
  POOL,
  USDT,
} from "../src/chain";
import { CURRENCIES, FEE_BPS, MIN_POOL_HISTORY, currencyOf, servedProblem } from "../src/currencies";
import { OUTSIDER, fundSnapshot, fundSnapshotV2, fundSnapshotWithoutDollar } from "./support/fixtures";

const UNIT = 10n ** 18n;

function currency(symbol: string) {
  const found = CURRENCIES.find((c) => c.symbol === symbol);
  if (!found) throw new Error(`No ${symbol} in the table`);
  return found;
}

describe("CURRENCIES", () => {
  it("has the six wFIAT on Celo, each with 18 decimals", () => {
    expect(CURRENCIES.map((c) => [c.symbol, c.token])).toEqual([
      ["wARS", "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"],
      ["wBRL", "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0"],
      ["wMXN", "0x337E7456B420bD3481e7FA61fA9850343d610d34"],
      ["wCOP", "0x8a1D45e102e886510e891d2Ec656a708991e2D76"],
      ["wPEN", "0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE"],
      ["wCLP", "0x61D450a098b6a7f69fC4b98CE68198fe59768651"],
    ]);
    expect(CURRENCIES.map((c) => c.country)).toEqual(["AR", "BR", "MX", "CO", "PE", "CL"]);
    expect(CURRENCIES.every((c) => c.decimals === 18)).toBe(true);
  });

  it("offers only wARS for now", () => {
    expect(CURRENCIES.filter((c) => c.offered).map((c) => c.symbol)).toEqual(["wARS"]);
  });

  it("gives only wARS a dollar entry, today's pool", () => {
    expect(currency("wARS").dollar).toEqual({ token: USDT, decimals: 6, pool: POOL, poolFee: 100 });
    for (const symbol of ["wBRL", "wMXN", "wCOP", "wPEN", "wCLP"]) {
      expect(currency(symbol).dollar).toBeNull();
    }
  });

  it("keeps wARS's limits as the agent's today", () => {
    expect(currency("wARS").limits).toEqual({
      reimbursement: 100_000n * UNIT,
      dailyReimbursed: 150_000n * UNIT,
      balanceCap: 450_000n * UNIT,
    });
  });

  it("sizes the others from the spec's table", () => {
    const whole = (reimbursement: bigint, dailyReimbursed: bigint, balanceCap: bigint) => ({
      reimbursement: reimbursement * UNIT,
      dailyReimbursed: dailyReimbursed * UNIT,
      balanceCap: balanceCap * UNIT,
    });
    expect(currency("wBRL").limits).toEqual(whole(350n, 500n, 1_500n));
    expect(currency("wMXN").limits).toEqual(whole(1_100n, 1_650n, 5_000n));
    expect(currency("wCOP").limits).toEqual(whole(200_000n, 300_000n, 900_000n));
    expect(currency("wPEN").limits).toEqual(whole(200n, 300n, 900n));
    expect(currency("wCLP").limits).toEqual(whole(60_000n, 90_000n, 250_000n));
  });

  it("has a Chainlink reference for ARS, BRL, COP and MXN only", () => {
    expect(currency("wARS").reference).toEqual({
      chain: "base",
      feed: "0x9eb8a54d0590798880C665C7A6d51B95f4078Ad7",
      perUsd: true,
      maxAge: 93_600n,
    });
    expect(currency("wBRL").reference).toEqual({
      chain: "celo",
      feed: "0xe8EcaF727080968Ed5F6DBB595B91e50eEb9F8B3",
      perUsd: false,
      maxAge: 600n,
    });
    expect(currency("wCOP").reference).toEqual({
      chain: "celo",
      feed: "0x97b770B0200CCe161907a9cbe0C6B177679f8F7C",
      perUsd: false,
      maxAge: 600n,
    });
    expect(currency("wMXN").reference).toEqual({
      chain: "base",
      feed: "0x9e8Ee77c76d4fa41306056D1C3196AF5da1600bd",
      perUsd: false,
      maxAge: 7_200n,
    });
    expect(currency("wPEN").reference).toBeNull();
    expect(currency("wCLP").reference).toBeNull();
  });

  it("has Ripio's ramp for AR, BR, MX and CO only", () => {
    expect(CURRENCIES.map((c) => [c.country, c.rampToken])).toEqual([
      ["AR", "WARS"],
      ["BR", "WBRL"],
      ["MX", "WMXN"],
      ["CO", "WCOP"],
      ["PE", null],
      ["CL", null],
    ]);
  });
});

describe("currencyOf", () => {
  it("finds a currency by its token in any case, and nothing else", () => {
    const wars = currency("wARS");
    expect(currencyOf(wars.token)).toBe(wars);
    expect(currencyOf(wars.token.toLowerCase() as Address)).toBe(wars);
    expect(currencyOf(USDT)).toBeUndefined();
  });
});

describe("servedProblem", () => {
  it("serves a v2 fund in wARS with USDT, like the ones the web creates, whatever its fee and a lower balance cap", () => {
    expect(servedProblem(fundSnapshotV2())).toBeNull();
    // The contract caps the fee at 1 %: the table's 25 bps are for the funds created from now on, not a condition.
    expect(servedProblem(fundSnapshotV2({ feeBps: 30 }))).toBeNull();
    expect(servedProblem(fundSnapshotV2({ feeBps: 100 }))).toBeNull();
    expect(servedProblem(fundSnapshotV2({ balanceCap: 400_000n * UNIT }))).toBeNull();
  });

  it("serves a v2 fund without a dollar, in any currency", () => {
    expect(servedProblem(fundSnapshotV2({ dollar: null, pool: null }))).toBeNull();
    expect(servedProblem(fundSnapshotWithoutDollar("wMXN", { balanceCap: 5_000n * UNIT }))).toBeNull();
    for (const { symbol } of CURRENCIES) expect(servedProblem(fundSnapshotWithoutDollar(symbol)), symbol).toBeNull();
  });

  it("doesn't serve a v2 fund whose balance cap is above the table's", () => {
    expect(servedProblem(fundSnapshotV2({ balanceCap: 450_000n * UNIT + 1n }))).toMatch(/balance cap.*wARS/);
    expect(servedProblem(fundSnapshotWithoutDollar("wMXN", { balanceCap: 5_000n * UNIT + 1n }))).toMatch(/balance cap.*wMXN/);
  });

  it("doesn't serve a v2 fund whose dollar and pool aren't the table's, or both missing", () => {
    expect(servedProblem(fundSnapshotV2({ pool: OUTSIDER }))).toMatch(/dollar and pool/);
    expect(servedProblem(fundSnapshotV2({ dollar: OUTSIDER }))).toMatch(/dollar and pool/);
    expect(servedProblem(fundSnapshotV2({ pool: null }))).toMatch(/dollar and pool/);
    expect(servedProblem(fundSnapshotV2({ dollar: null }))).toMatch(/dollar and pool/);
    // wMXN has no dollar in the table: a fund of it with one isn't the table's.
    expect(servedProblem(fundSnapshotWithoutDollar("wMXN", { dollar: USDT, pool: POOL }))).toMatch(/dollar and pool/);
  });

  it("doesn't serve a v2 fund in a currency the table doesn't have", () => {
    expect(servedProblem(fundSnapshotV2({ currency: USDT }))).toMatch(/currency/);
  });

  it("serves any v1 fund: they are the ones the agent always ran", () => {
    expect(servedProblem(fundSnapshot())).toBeNull();
    expect(servedProblem(fundSnapshot({ currency: USDT, dollar: null, pool: null, balanceCap: 10n ** 30n }))).toBeNull();
  });
});

describe("the fund constants", () => {
  it("sets the fee at 25 bps and the pool history at 6 hours", () => {
    expect(FEE_BPS).toBe(25);
    expect(MIN_POOL_HISTORY).toBe(6n * 3_600n);
  });
});

describe("FACTORIES", () => {
  it("lists FundFactory as version 1, then FundFactoryV2 as version 2", () => {
    expect(FACTORIES).toEqual([
      { address: FUND_FACTORY, block: FUND_FACTORY_BLOCK, version: 1 },
      { address: "0x1337a61CF7fDeF412E04894FE705d4341878d4d3", block: 83_102_288n, version: 2 },
    ]);
    expect(FACTORIES.map((f) => f.address)).toEqual([FUND_FACTORY, FUND_FACTORY_V2]);
    expect(FACTORIES.map((f) => f.block)).toEqual([FUND_FACTORY_BLOCK, FUND_FACTORY_V2_BLOCK]);
  });

  it("names the account that receives v2's fee", () => {
    expect(FEE_RECIPIENT).toBe("0x5Dc9C76C6999C6C604b3D91C040D17b125ca4581");
  });
});
