import { type Address, decodeFunctionData, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { fundAbi, fundV2Abi } from "../src/abi";
import { USDT } from "../src/chain";
import {
  type DailyActivity,
  DAY_BLOCKS,
  LIMITS,
  LimitError,
  authorize,
  conversionLimits,
  dailyActivity,
  reimbursementLimits,
} from "../src/limits";
import {
  AGENT,
  BLOCK,
  FUND,
  MEMBERS,
  OUTSIDER,
  USDT_UNIT,
  WARS_UNIT,
  converted,
  feePaid,
  fundSnapshot,
  fundSnapshotV2,
  fundSnapshotWithPending,
  fundSnapshotWithoutDollar,
  proposed,
  ref,
  reimbursed,
} from "./support/fixtures";

const MEMBER = MEMBERS[1] as Address;
const QUIET_DAY: DailyActivity = { reimbursed: 0n, convertedDollar: 0n, transactions: 0 };

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
      reimbursed: 20_000n * WARS_UNIT,
      convertedDollar: 50n * USDT_UNIT,
      transactions: 3,
    });
  });

  it("counts the transaction of each fee sent among the day's transactions", () => {
    const since = BLOCK - DAY_BLOCKS;
    const events = [
      feePaid(5n * WARS_UNIT, since, 1), // a day and a block ago: left out
      feePaid(7n * WARS_UNIT, since + 1n, 2),
      // The same transaction as a conversion's counts once.
      converted(50n * USDT_UNIT, BLOCK - 5n, 3),
      feePaid(1n * WARS_UNIT, BLOCK - 5n, 3),
    ];
    expect(dailyActivity(events, AGENT, since)).toEqual({ reimbursed: 0n, convertedDollar: 50n * USDT_UNIT, transactions: 2 });
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
    const fund = fundSnapshot({ dollarBalance: 20n * USDT_UNIT });
    const convert = authorize({ kind: "convert", dollarAmount: 20n * USDT_UNIT, minCurrencyOut: 31_000n * WARS_UNIT }, fund, QUIET_DAY, AGENT);
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

  it("encodes propose(GiveBack) and payFee", () => {
    const fund = fundSnapshotV2({ feeOwed: 40n * WARS_UNIT });
    // The member comes out as the contract lists it, whatever the case it was given in.
    const giveBack = authorize(
      { kind: "propose-give-back", member: MEMBER.toLowerCase() as Address, amount: 5n * WARS_UNIT, note: "Deposité en otro fondo" },
      fund,
      QUIET_DAY,
      AGENT,
    );
    expect(giveBack.to).toBe(FUND);
    expect(decodeFunctionData({ abi: fundV2Abi, data: giveBack.data })).toEqual({
      functionName: "propose",
      args: [8, MEMBER, zeroAddress, 5n * WARS_UNIT, "Deposité en otro fondo"],
    });
    const fee = authorize({ kind: "pay-fee" }, fund, QUIET_DAY, AGENT);
    expect(fee.to).toBe(FUND);
    expect(decodeFunctionData({ abi: fundV2Abi, data: fee.data })).toMatchObject({ functionName: "payFee" });
  });

  it("holds a give-back to what a payment proposal is held to, and the fee to the day's transactions", () => {
    const fund = fundSnapshotV2({ feeOwed: 40n * WARS_UNIT });
    const giveBack = (change: { member?: Address; amount?: bigint; note?: string }) => () =>
      authorize({ kind: "propose-give-back", member: MEMBER, amount: 1n, note: "", ...change }, fund, QUIET_DAY, AGENT);
    expect(giveBack({ member: OUTSIDER })).toThrow("is not a member");
    expect(giveBack({ amount: 0n })).toThrow("Nothing to give back");
    expect(giveBack({ note: "ñ".repeat(140) })).not.toThrow();
    expect(giveBack({ note: "ñ".repeat(141) })).toThrow(LimitError);
    const busyDay = { ...QUIET_DAY, transactions: LIMITS.maxDailyTransactions };
    expect(() => authorize({ kind: "pay-fee" }, fund, busyDay, AGENT)).toThrow("transactions for this fund in the last day");
    expect(() => authorize({ kind: "pay-fee" }, fundSnapshotV2({ feeOwed: 1n, agent: OUTSIDER }), QUIET_DAY, AGENT)).toThrow("not the fund's agent");
  });

  it("refuses both on a v1 fund", () => {
    const fund = fundSnapshot({ feeOwed: 40n * WARS_UNIT });
    expect(() => authorize({ kind: "propose-give-back", member: MEMBER, amount: 1n, note: "" }, fund, QUIET_DAY, AGENT)).toThrow(LimitError);
    expect(() => authorize({ kind: "propose-give-back", member: MEMBER, amount: 1n, note: "" }, fund, QUIET_DAY, AGENT)).toThrow("version 2");
    expect(() => authorize({ kind: "pay-fee" }, fund, QUIET_DAY, AGENT)).toThrow(LimitError);
    expect(() => authorize({ kind: "pay-fee" }, fund, QUIET_DAY, AGENT)).toThrow("version 2");
  });

  it("refuses payFee when the fund owes no fee", () => {
    expect(() => authorize({ kind: "pay-fee" }, fundSnapshotV2({ feeOwed: 0n }), QUIET_DAY, AGENT)).toThrow("owes no fee");
  });

  it("allows payFee on a closed v2 fund, and nothing else", () => {
    // The contract lets anyone send the fee with the fund closed, and the last one is still owed.
    const fund = fundSnapshotWithPending([3n * USDT_UNIT, 0n, 0n], { closed: true, feeOwed: 40n * WARS_UNIT });
    expect(() => authorize({ kind: "pay-fee" }, fund, QUIET_DAY, AGENT)).not.toThrow();
    const ana = MEMBERS[0] as Address;
    const refused: Parameters<typeof authorize>[0][] = [
      { kind: "convert", dollarAmount: 3n * USDT_UNIT, minCurrencyOut: 1n, members: [ana], amounts: [3n * USDT_UNIT] },
      { kind: "reimburse", member: MEMBER, amount: 1n, ref: ref(1) },
      { kind: "propose-payment", member: MEMBER, amount: 1n, note: "" },
      { kind: "propose-give-back", member: MEMBER, amount: 1n, note: "" },
    ];
    for (const action of refused) expect(() => authorize(action, fund, QUIET_DAY, AGENT), action.kind).toThrow("The fund is closed");
  });

  it("encodes FundV2's convert with each member and amount", () => {
    const fund = fundSnapshotWithPending([3n * USDT_UNIT, 2n * USDT_UNIT, 0n]);
    // The members come out as the contract lists them, whatever the case they were given in.
    const members = [MEMBERS[0] as Address, (MEMBERS[1] as Address).toLowerCase() as Address];
    const tx = authorize(
      { kind: "convert", dollarAmount: 5n * USDT_UNIT, minCurrencyOut: 8_000n * WARS_UNIT, members, amounts: [3n * USDT_UNIT, 2n * USDT_UNIT] },
      fund,
      QUIET_DAY,
      AGENT,
    );
    expect(tx.to).toBe(FUND);
    expect(decodeFunctionData({ abi: fundV2Abi, data: tx.data })).toEqual({
      functionName: "convert",
      args: [[MEMBERS[0], MEMBERS[1]], [3n * USDT_UNIT, 2n * USDT_UNIT], 8_000n * WARS_UNIT],
    });
  });

  it("refuses to convert more than a member has pending, or for someone who isn't a member", () => {
    const fund = fundSnapshotWithPending([3n * USDT_UNIT, 2n * USDT_UNIT, 0n], { dollarBalance: 300n * USDT_UNIT });
    const [ana, beto, caro] = MEMBERS as [Address, Address, Address];
    const convert = (members: Address[], amounts: bigint[], dollarAmount = amounts.reduce((sum, a) => sum + a, 0n)) => () =>
      authorize({ kind: "convert", dollarAmount, minCurrencyOut: 1n, members, amounts }, fund, QUIET_DAY, AGENT);

    expect(convert([ana, beto], [3n * USDT_UNIT, 2n * USDT_UNIT])).not.toThrow();
    expect(convert([ana, beto], [3n * USDT_UNIT + 1n, 2n * USDT_UNIT])).toThrow(LimitError);
    expect(convert([ana, beto], [3n * USDT_UNIT + 1n, 2n * USDT_UNIT])).toThrow("more than");
    // Dollars sent straight to the fund (the 300 USDT balance) are nobody's pending.
    expect(convert([caro], [1n])).toThrow("more than");
    expect(convert([OUTSIDER], [1n])).toThrow("is not a member");
    // The sum is the amount the action says, and the lists line up.
    expect(convert([ana, beto], [3n * USDT_UNIT, 2n * USDT_UNIT], 4n * USDT_UNIT)).toThrow("add up");
    expect(convert([ana], [3n * USDT_UNIT, 2n * USDT_UNIT])).toThrow("same number");
    expect(convert([], [], 1n)).toThrow("names no member");
    // The contract rejects a member twice, and a zero amount.
    expect(convert([ana, ana], [1n * USDT_UNIT, 1n * USDT_UNIT])).toThrow("twice");
    expect(convert([ana, beto], [3n * USDT_UNIT, 0n], 3n * USDT_UNIT)).toThrow("Nothing to convert");
    // A v2 conversion without the lists, and a v1 one with them, are not what the contract takes.
    expect(() => authorize({ kind: "convert", dollarAmount: 5n * USDT_UNIT, minCurrencyOut: 1n }, fund, QUIET_DAY, AGENT)).toThrow(
      "names no member",
    );
    const v1 = fundSnapshot({ dollarBalance: 20n * USDT_UNIT });
    expect(() =>
      authorize({ kind: "convert", dollarAmount: 5n * USDT_UNIT, minCurrencyOut: 1n, members: [ana], amounts: [5n * USDT_UNIT] }, v1, QUIET_DAY, AGENT),
    ).toThrow("version 1");
  });

  it("holds the per-conversion and daily limits in a v2 convert too", () => {
    const fund = fundSnapshotWithPending([600n * USDT_UNIT, 600n * USDT_UNIT, 0n]);
    const [ana, beto] = MEMBERS as [Address, Address, Address];
    const convert = (amounts: bigint[], today = QUIET_DAY) => () =>
      authorize(
        { kind: "convert", dollarAmount: amounts.reduce((sum, a) => sum + a, 0n), minCurrencyOut: 1n, members: [ana, beto].slice(0, amounts.length), amounts },
        fund,
        today,
        AGENT,
      );
    expect(convert([400n * USDT_UNIT, 100n * USDT_UNIT])).not.toThrow();
    expect(convert([400n * USDT_UNIT, 100n * USDT_UNIT + 1n])).toThrow("per-conversion limit");
    const after600 = { ...QUIET_DAY, convertedDollar: 600n * USDT_UNIT };
    expect(convert([400n * USDT_UNIT], after600)).not.toThrow();
    expect(convert([400n * USDT_UNIT, 1n], after600)).toThrow("daily conversion limit");
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
    const fund = fundSnapshot({ weeklyCap: 10_000_000n * WARS_UNIT, currencyBalance: 10_000_000n * WARS_UNIT, dollarBalance: 10_000n * USDT_UNIT });
    const reimburse = (amount: bigint, today = QUIET_DAY) =>
      authorize({ kind: "reimburse", member: MEMBER, amount, ref: ref(1) }, fund, today, AGENT);
    const convert = (dollarAmount: bigint, today = QUIET_DAY) =>
      authorize({ kind: "convert", dollarAmount, minCurrencyOut: 1n }, fund, today, AGENT);

    const { perReimbursement, perDay } = reimbursementLimits(fund);
    expect(() => reimburse(perReimbursement)).not.toThrow();
    expect(() => reimburse(perReimbursement + 1n)).toThrow("per-reimbursement limit");
    const reimbursedToday = { ...QUIET_DAY, reimbursed: perDay - 1n };
    expect(() => reimburse(2n, reimbursedToday)).toThrow("daily reimbursement limit");

    const { perConversion, perDay: convertedPerDay } = conversionLimits(fund);
    expect(() => convert(perConversion)).not.toThrow();
    expect(() => convert(perConversion + 1n)).toThrow("per-conversion limit");
    const convertedToday = { ...QUIET_DAY, convertedDollar: convertedPerDay - 1n };
    expect(() => convert(2n, convertedToday)).toThrow("daily conversion limit");

    const busyDay = { ...QUIET_DAY, transactions: LIMITS.maxDailyTransactions };
    expect(() => convert(1n, busyDay)).toThrow("transactions for this fund in the last day");
  });

  it("checks the weekly cap and the balances like the contract does", () => {
    const fund = fundSnapshot({ spentThisWeek: 50_000n * WARS_UNIT, currencyBalance: 8_000n * WARS_UNIT, dollarBalance: 1n });
    const reimburse = (amount: bigint) =>
      authorize({ kind: "reimburse", member: MEMBER, amount, ref: ref(1) }, fund, QUIET_DAY, AGENT);
    expect(() => reimburse(10_001n * WARS_UNIT)).toThrow("this week's cap");
    expect(() => reimburse(9_000n * WARS_UNIT)).toThrow("doesn't hold that much wARS");
    expect(() => authorize({ kind: "convert", dollarAmount: 2n, minCurrencyOut: 1n }, fund, QUIET_DAY, AGENT)).toThrow(
      "doesn't hold that much USDT",
    );
  });

  it("limits a wMXN fund's reimbursements in wMXN", () => {
    const fund = fundSnapshotWithoutDollar("wMXN", { weeklyCap: 10_000n * WARS_UNIT, currencyBalance: 10_000n * WARS_UNIT });
    const reimburse = (amount: bigint, today = QUIET_DAY) =>
      authorize({ kind: "reimburse", member: MEMBER, amount, ref: ref(1) }, fund, today, AGENT);

    // wARS's 100,000 would have let all of these through.
    expect(() => reimburse(1_100n * WARS_UNIT)).not.toThrow();
    expect(() => reimburse(1_101n * WARS_UNIT)).toThrow(LimitError);
    expect(() => reimburse(1_101n * WARS_UNIT)).toThrow("per-reimbursement limit");
    const reimbursedToday = { ...QUIET_DAY, reimbursed: 1_649n * WARS_UNIT };
    expect(() => reimburse(1n * WARS_UNIT, reimbursedToday)).not.toThrow();
    expect(() => reimburse(2n * WARS_UNIT, reimbursedToday)).toThrow("daily reimbursement limit");
    expect(reimbursementLimits(fund)).toEqual({ perReimbursement: 1_100n * WARS_UNIT, perDay: 1_650n * WARS_UNIT });
  });

  it("gives wARS's limits to a fund in wARS, as the agent always had them", () => {
    expect(reimbursementLimits(fundSnapshot())).toEqual({ perReimbursement: 100_000n * WARS_UNIT, perDay: 150_000n * WARS_UNIT });
    expect(reimbursementLimits(fundSnapshotV2())).toEqual({ perReimbursement: 100_000n * WARS_UNIT, perDay: 150_000n * WARS_UNIT });
  });

  it("scales the conversion limits, in whole dollars, by the dollar's decimals", () => {
    expect(LIMITS).toEqual({ maxConversionDollar: 500n, maxDailyConvertedDollar: 1_000n, maxDailyTransactions: 20 });
    expect(conversionLimits(fundSnapshot())).toEqual({ perConversion: 500n * USDT_UNIT, perDay: 1_000n * USDT_UNIT });
    expect(conversionLimits(fundSnapshotV2())).toEqual({ perConversion: 500n * USDT_UNIT, perDay: 1_000n * USDT_UNIT });
  });

  it("has no conversion limits for a fund without a dollar", () => {
    expect(() => conversionLimits(fundSnapshotWithoutDollar("wMXN"))).toThrow(LimitError);
    expect(() => conversionLimits(fundSnapshotV2({ dollar: null, pool: null }))).toThrow("no dollar");
  });

  it("refuses a fund whose currency isn't in the table", () => {
    const fund = fundSnapshotV2({ currency: USDT });
    expect(() => reimbursementLimits(fund)).toThrow(LimitError);
    expect(() => authorize({ kind: "reimburse", member: MEMBER, amount: 1n, ref: ref(1) }, fund, QUIET_DAY, AGENT)).toThrow(
      "isn't in the agent's table",
    );
  });

  it("checks a payment against what a v2 fund can pay, not its balance", () => {
    // availableCurrency(): what the fund holds less the fee it owes, so a payment above it would revert.
    const fund = fundSnapshotWithoutDollar("wMXN", { feeOwed: 40n * WARS_UNIT, currencyBalance: 1_000n * WARS_UNIT });
    const reimburse = (amount: bigint) =>
      authorize({ kind: "reimburse", member: MEMBER, amount, ref: ref(1) }, fund, QUIET_DAY, AGENT);
    expect(() => reimburse(1_000n * WARS_UNIT)).not.toThrow();
    expect(() => reimburse(1_000n * WARS_UNIT + 1n)).toThrow("doesn't hold that much wMXN");
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
