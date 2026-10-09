import { type Address, decodeFunctionData, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { fundAbi } from "../src/abi";
import { type DailyActivity, DAY_BLOCKS, LIMITS, LimitError, authorize, dailyActivity } from "../src/limits";
import {
  AGENT,
  BLOCK,
  FUND,
  MEMBERS,
  OUTSIDER,
  USDT_UNIT,
  WARS_UNIT,
  converted,
  fundSnapshot,
  proposed,
  ref,
  reimbursed,
} from "./support/fixtures";

const MEMBER = MEMBERS[1] as Address;
const QUIET_DAY: DailyActivity = { reimbursedWars: 0n, convertedUsdt: 0n, transactions: 0 };

describe("dailyActivity", () => {
  it("adds up the last day's reimbursements, conversions and the agent's own proposals", () => {
    const since = BLOCK - DAY_BLOCKS;
    const events = [
      reimbursed(MEMBER, 10_000n * WARS_UNIT, ref(1), since, 1), // a day and a block ago: left out
      reimbursed(MEMBER, 20_000n * WARS_UNIT, ref(2), since + 1n, 2),
      converted(50n * USDT_UNIT, BLOCK - 5n, 3),
      proposed(AGENT, BLOCK - 4n, 4),
      proposed(MEMBERS[0] as Address, BLOCK - 3n, 5), // a member's proposal isn't the agent's
    ];
    expect(dailyActivity(events, AGENT, since)).toEqual({
      reimbursedWars: 20_000n * WARS_UNIT,
      convertedUsdt: 50n * USDT_UNIT,
      transactions: 3,
    });
  });
});

describe("authorize", () => {
  it("encodes a reimbursement to the member as the contract lists it", () => {
    const fund = fundSnapshot();
    const lowercase = MEMBER.toLowerCase() as Address;
    const tx = authorize({ kind: "reimburse", member: lowercase, amount: 20_000n * WARS_UNIT, ref: ref(7) }, fund, QUIET_DAY, AGENT);
    expect(tx.to).toBe(FUND);
    const call = decodeFunctionData({ abi: fundAbi, data: tx.data });
    expect(call).toEqual({ functionName: "reimburseAgreedExpense", args: [MEMBER, 20_000n * WARS_UNIT, ref(7)] });
  });

  it("encodes a conversion and a payment proposal", () => {
    const fund = fundSnapshot({ usdtBalance: 20n * USDT_UNIT });
    const convert = authorize({ kind: "convert", usdtAmount: 20n * USDT_UNIT, minWarsOut: 31_000n * WARS_UNIT }, fund, QUIET_DAY, AGENT);
    expect(decodeFunctionData({ abi: fundAbi, data: convert.data })).toEqual({
      functionName: "convert",
      args: [20n * USDT_UNIT, 31_000n * WARS_UNIT],
    });
    const propose = authorize({ kind: "propose-payment", member: MEMBER, amount: 5n * WARS_UNIT, note: "Pelotas" }, fund, QUIET_DAY, AGENT);
    expect(decodeFunctionData({ abi: fundAbi, data: propose.data })).toEqual({
      functionName: "propose",
      args: [0, MEMBER, zeroAddress, 5n * WARS_UNIT, "Pelotas"],
    });
  });

  it("never pays or proposes to pay an address the contract doesn't list as a member", () => {
    const fund = fundSnapshot();
    expect(() => authorize({ kind: "reimburse", member: OUTSIDER, amount: 1n, ref: ref(1) }, fund, QUIET_DAY, AGENT)).toThrow(
      "is not a member",
    );
    expect(() => authorize({ kind: "propose-payment", member: OUTSIDER, amount: 1n, note: "" }, fund, QUIET_DAY, AGENT)).toThrow(
      "is not a member",
    );
  });

  it("holds the per-transaction and daily limits", () => {
    const fund = fundSnapshot({ weeklyCap: 10_000_000n * WARS_UNIT, warsBalance: 10_000_000n * WARS_UNIT, usdtBalance: 10_000n * USDT_UNIT });
    const reimburse = (amount: bigint, today = QUIET_DAY) =>
      authorize({ kind: "reimburse", member: MEMBER, amount, ref: ref(1) }, fund, today, AGENT);
    const convert = (usdtAmount: bigint, today = QUIET_DAY) =>
      authorize({ kind: "convert", usdtAmount, minWarsOut: 1n }, fund, today, AGENT);

    expect(() => reimburse(LIMITS.maxReimbursementWars)).not.toThrow();
    expect(() => reimburse(LIMITS.maxReimbursementWars + 1n)).toThrow("per-reimbursement limit");
    const reimbursedToday = { ...QUIET_DAY, reimbursedWars: LIMITS.maxDailyReimbursedWars - 1n };
    expect(() => reimburse(2n, reimbursedToday)).toThrow("daily reimbursement limit");

    expect(() => convert(LIMITS.maxConversionUsdt)).not.toThrow();
    expect(() => convert(LIMITS.maxConversionUsdt + 1n)).toThrow("per-conversion limit");
    const convertedToday = { ...QUIET_DAY, convertedUsdt: LIMITS.maxDailyConvertedUsdt - 1n };
    expect(() => convert(2n, convertedToday)).toThrow("daily conversion limit");

    const busyDay = { ...QUIET_DAY, transactions: LIMITS.maxDailyTransactions };
    expect(() => convert(1n, busyDay)).toThrow("transactions for this fund in the last day");
  });

  it("checks the weekly cap and the balances like the contract does", () => {
    const fund = fundSnapshot({ spentThisWeek: 50_000n * WARS_UNIT, warsBalance: 8_000n * WARS_UNIT, usdtBalance: 1n });
    const reimburse = (amount: bigint) =>
      authorize({ kind: "reimburse", member: MEMBER, amount, ref: ref(1) }, fund, QUIET_DAY, AGENT);
    expect(() => reimburse(10_001n * WARS_UNIT)).toThrow("this week's cap");
    expect(() => reimburse(9_000n * WARS_UNIT)).toThrow("doesn't hold that much wARS");
    expect(() => authorize({ kind: "convert", usdtAmount: 2n, minWarsOut: 1n }, fund, QUIET_DAY, AGENT)).toThrow(
      "doesn't hold that much USDT",
    );
  });

  it("refuses to act for a fund whose agent is someone else, or a closed fund", () => {
    const action = { kind: "reimburse", member: MEMBER, amount: 1n, ref: ref(1) } as const;
    expect(() => authorize(action, fundSnapshot({ agent: OUTSIDER }), QUIET_DAY, AGENT)).toThrow("not the fund's agent");
    expect(() => authorize(action, fundSnapshot({ closed: true }), QUIET_DAY, AGENT)).toThrow("closed");
  });

  it("refuses a note longer than 140 characters, counting accents as one", () => {
    const fund = fundSnapshot();
    const propose = (note: string) => () =>
      authorize({ kind: "propose-payment", member: MEMBER, amount: 1n, note }, fund, QUIET_DAY, AGENT);
    expect(propose("ñ".repeat(140))).not.toThrow();
    expect(propose("ñ".repeat(141))).toThrow(LimitError);
  });
});
