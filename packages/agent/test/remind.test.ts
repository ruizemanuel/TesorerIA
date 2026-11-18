import { type Address, type Hash, getAddress, pad, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { USDT, WARS } from "../src/chain";
import type { FundEvent } from "../src/events";
import { closeShares, conversionLoss, givenBack, joinWeeks, memberDues, weekSummary } from "../src/remind";
import {
  BLOCK,
  MEMBERS,
  OUTSIDER,
  USDT_UNIT,
  WARS_UNIT,
  converted,
  fundSnapshot,
  memberAdded,
  memberReplaced,
  reimbursed,
  ref,
} from "./support/fixtures";

const [ANA, BETO, CARLA] = MEMBERS as [Address, Address, Address];
const FEE = 10_000n * WARS_UNIT;

describe("joinWeeks", () => {
  it("dates an added member by its event, and a replacement by its predecessor", () => {
    const weekOfBlock = new Map([
      [100n, 1n],
      [200n, 3n],
    ]);
    const events = [memberAdded(OUTSIDER, 100n), memberReplaced(OUTSIDER, CARLA, 200n), memberReplaced(ANA, BETO, 200n)];
    const weeks = joinWeeks(events, (event: FundEvent) => weekOfBlock.get(event.blockNumber) ?? 0n);
    expect(weeks).toEqual(
      new Map([
        [OUTSIDER, 1n],
        [CARLA, 1n],
        [BETO, 0n],
      ]),
    );
  });
});

describe("memberDues", () => {
  it("counts the fee from the week each member joined through the current one", () => {
    // Week 2: the founders owe three fees; Carla joined in week 1 and owes two.
    const fund = fundSnapshot({ contributed: [30_000n * WARS_UNIT, 20_000n * WARS_UNIT, 0n] });
    const dues = memberDues({ fund, weeklyFee: FEE, joined: new Map([[CARLA, 1n]]) });
    expect(dues).toEqual([
      { member: ANA, due: 30_000n * WARS_UNIT, contributed: 30_000n * WARS_UNIT, owed: 0n },
      { member: BETO, due: 30_000n * WARS_UNIT, contributed: 20_000n * WARS_UNIT, owed: 10_000n * WARS_UNIT },
      { member: CARLA, due: 20_000n * WARS_UNIT, contributed: 0n, owed: 20_000n * WARS_UNIT },
    ]);
  });

  it("owes nothing to whoever paid ahead", () => {
    const fund = fundSnapshot({ contributed: [90_000n * WARS_UNIT, 30_000n * WARS_UNIT, 30_000n * WARS_UNIT] });
    expect(memberDues({ fund, weeklyFee: FEE, joined: new Map() })[0]?.owed).toBe(0n);
  });

  it("owes nothing under 0,5 % of the weekly fee, and it goes with the next week's", () => {
    // The real fund, 12/10: 5 USDT credited as 8,034.2278… wARS, then the $ 1.965,77 the screen showed.
    const credited = 8_034_227_833_761_027_780_166n;
    const shown = 1_965_770_000_000_000_000_000n;
    const owed = (contributed: bigint, week = 0n) =>
      memberDues({ fund: fundSnapshot({ week, contributed: [contributed, 0n, 0n] }), weeklyFee: FEE, joined: new Map() })[0]?.owed;
    expect(owed(credited + shown)).toBe(0n);
    expect(owed(FEE - (4_999n * WARS_UNIT) / 100n)).toBe(0n); // $ 49,99
    expect(owed(FEE - 50n * WARS_UNIT)).toBe(50n * WARS_UNIT);
    expect(owed(FEE - (4_999n * WARS_UNIT) / 100n, 1n)).toBe(FEE + (4_999n * WARS_UNIT) / 100n);
  });
});

describe("memberDues, with what converting their USDT lost (conversion-loss design)", () => {
  it("takes what converting a member's USDT lost off what they put in, and adds what it gained", () => {
    // Week 2: everyone put in 30.000, which is what they owe.
    const fund = fundSnapshot();
    const carla = (loss: bigint, back = 0n, contributed = 30_000n * WARS_UNIT) =>
      memberDues({
        fund: fundSnapshot({ contributed: [30_000n * WARS_UNIT, 30_000n * WARS_UNIT, contributed] }),
        weeklyFee: FEE,
        joined: new Map(),
        givenBack: new Map([[CARLA, back]]),
        conversionLoss: new Map([[CARLA, loss]]),
      })[2];
    expect(carla(60n * WARS_UNIT)).toMatchObject({ contributed: 29_940n * WARS_UNIT, owed: 60n * WARS_UNIT });
    expect(carla((2_890n * WARS_UNIT) / 100n)).toMatchObject({ owed: 0n }); // $ 28,90: under $ 50
    expect(carla(-20n * WARS_UNIT)).toMatchObject({ contributed: 30_020n * WARS_UNIT, owed: 0n });
    expect(carla(40_000n * WARS_UNIT)).toMatchObject({ contributed: 0n, owed: 30_000n * WARS_UNIT }); // never below zero
    expect(carla(60n * WARS_UNIT, 10_000n * WARS_UNIT, 40_000n * WARS_UNIT)).toMatchObject({ contributed: 29_940n * WARS_UNIT, owed: 60n * WARS_UNIT });
    expect(memberDues({ fund, weeklyFee: FEE, joined: new Map(), conversionLoss: new Map([[CARLA, 60n * WARS_UNIT]]) }).slice(0, 2).map((d) => d.owed)).toEqual([0n, 0n]);
  });
});

describe("memberDues, with what was given back (spec, 7.3)", () => {
  it("takes what a member was given back off their contributions: the contract can't lower them", () => {
    // Week 2: Carla put in 40.000 and was given 10.000 back, so she's even; given 20.000 back, she owes 10.000.
    const fund = fundSnapshot({ contributed: [30_000n * WARS_UNIT, 30_000n * WARS_UNIT, 40_000n * WARS_UNIT] });
    const dues = (back: bigint) => memberDues({ fund, weeklyFee: FEE, joined: new Map(), givenBack: new Map([[CARLA, back]]) });
    expect(dues(10_000n * WARS_UNIT)[2]).toEqual({ member: CARLA, due: 30_000n * WARS_UNIT, contributed: 30_000n * WARS_UNIT, owed: 0n });
    expect(dues(20_000n * WARS_UNIT)[2]).toMatchObject({ contributed: 20_000n * WARS_UNIT, owed: 10_000n * WARS_UNIT });
    expect(dues(50_000n * WARS_UNIT)[2]).toMatchObject({ contributed: 0n, owed: 30_000n * WARS_UNIT }); // never below zero
    expect(dues(10_000n * WARS_UNIT).slice(0, 2).map((d) => d.contributed)).toEqual([30_000n * WARS_UNIT, 30_000n * WARS_UNIT]);
  });
});

describe("givenBack", () => {
  const at = (block: bigint, tx: number, logIndex: number) => ({ blockNumber: block, transactionHash: pad(toHex(tx), { size: 32 }) as Hash, logIndex });
  const payment = (member: Address, amount: bigint, tx: number, logIndex: number): FundEvent => ({ eventName: "Payment", args: { member, amount }, ...at(BLOCK - 50n, tx, logIndex) });
  const executed = (id: bigint, tx: number, logIndex: number): FundEvent => ({ eventName: "ProposalExecuted", args: { id }, ...at(BLOCK - 50n, tx, logIndex) });

  it("adds up the payments of the proposals that gave a contribution back, each with the execution that follows it", () => {
    const events = [
      // One batch: proposal 3 pays the pitch to Beto, proposal 4 gives Carla back 10.000.
      payment(BETO, 80_000n * WARS_UNIT, 20, 0),
      executed(3n, 20, 1),
      payment(CARLA, 10_000n * WARS_UNIT, 20, 2),
      executed(4n, 20, 3),
      payment(CARLA, 2_500n * WARS_UNIT, 21, 0),
      executed(6n, 21, 1),
    ];
    expect(givenBack(events, new Set([4n, 6n]))).toEqual(new Map([[CARLA, 12_500n * WARS_UNIT]]));
    expect(givenBack(events, new Set())).toEqual(new Map());
  });

  it("moves it to a member's new account, and drops it with a member who leaves, as the contract does with contributions", () => {
    const back = [payment(CARLA, 10_000n * WARS_UNIT, 20, 0), executed(4n, 20, 1), payment(BETO, 5_000n * WARS_UNIT, 21, 0), executed(5n, 21, 1)];
    const removed: FundEvent = { eventName: "MemberRemoved", args: { member: BETO, currencyReturned: 0n, dollarReturned: 0n }, ...at(BLOCK - 10n, 23, 0) };
    expect(givenBack([...back, memberReplaced(CARLA, OUTSIDER, BLOCK - 20n, 22), removed], new Set([4n, 5n]))).toEqual(new Map([[OUTSIDER, 10_000n * WARS_UNIT]]));
  });
});

describe("conversionLoss (conversion-loss design)", () => {
  const W = WARS_UNIT;
  const U = USDT_UNIT;
  const DIEGO = getAddress("0x000000000000000000000000000000000000d1e6");
  const at = (block: bigint, tx: number) => ({ blockNumber: block, transactionHash: pad(toHex(tx), { size: 32 }) as Hash, logIndex: 0 });
  const paidUsdt = (member: Address, usdt: bigint, credited: bigint, block: bigint, tx: number): FundEvent => ({
    eventName: "Contribution",
    args: { member, token: USDT, amount: usdt, credited: credited },
    ...at(block, tx),
  });
  const conversion = (dollarIn: bigint, currencyOut: bigint, block: bigint, tx: number): FundEvent => ({ eventName: "Conversion", args: { dollarIn, currencyOut }, ...at(block, tx) });
  const key = (event: FundEvent) => `${event.transactionHash}:${event.logIndex}`;

  it("charges a member what their USDT brought under what it was credited", () => {
    const conv = conversion(6n * U, 9_997n * W, BLOCK - 90n, 31);
    const loss = conversionLoss([paidUsdt(ANA, 6n * U, 10_000n * W, BLOCK - 100n, 30), conv]);
    expect(loss.byMember).toEqual(new Map([[ANA, 3n * W]]));
    expect(loss.byConversion.get(key(conv))).toEqual({ difference: 3n * W, members: [ANA] });
  });

  it("values each USDT of a batch at the same price, whatever it was credited at", () => {
    const conv = conversion(12n * U, 20_000n * W, BLOCK - 90n, 32);
    const loss = conversionLoss([paidUsdt(ANA, 6n * U, 10_000n * W, BLOCK - 100n, 30), paidUsdt(BETO, 6n * U, 10_060n * W, BLOCK - 95n, 31), conv]);
    expect(loss.byMember).toEqual(
      new Map([
        [ANA, 0n],
        [BETO, 60n * W],
      ]),
    );
    expect(loss.byConversion.get(key(conv))).toEqual({ difference: 60n * W, members: [ANA, BETO] });
  });

  it("follows a contribution converted in two parts, and gives back a gain", () => {
    const first = conversion(4n * U, 6_380n * W, BLOCK - 90n, 31);
    const second = conversion(6n * U, 9_630n * W, BLOCK - 80n, 32);
    const loss = conversionLoss([paidUsdt(ANA, 10n * U, 16_000n * W, BLOCK - 100n, 30), first, second]);
    expect(loss.byMember).toEqual(new Map([[ANA, -10n * W]]));
    expect(loss.byConversion.get(key(first))?.difference).toBe(20n * W);
    expect(loss.byConversion.get(key(second))?.difference).toBe(-30n * W);
  });

  it("gives nobody the USDT that came in without contributeUsdt", () => {
    const conv = conversion(9n * U, 14_400n * W, BLOCK - 90n, 31);
    const loss = conversionLoss([paidUsdt(ANA, 6n * U, 10_000n * W, BLOCK - 100n, 30), conv]);
    expect(loss.byMember).toEqual(new Map([[ANA, 400n * W]]));
    expect(loss.byConversion.get(key(conv))).toEqual({ difference: 400n * W, members: [ANA] });
  });

  it("leaves out wARS contributions and USDT not converted yet", () => {
    const inWars: FundEvent = { eventName: "Contribution", args: { member: ANA, token: WARS, amount: 10_000n * W, credited: 10_000n * W }, ...at(BLOCK - 100n, 30) };
    const loss = conversionLoss([inWars, paidUsdt(BETO, 6n * U, 10_000n * W, BLOCK - 95n, 31)]);
    expect(loss.byMember).toEqual(new Map());
    expect(loss.byConversion).toEqual(new Map());
  });

  it("moves a member's loss and their USDT waiting to their new account", () => {
    const later = conversion(6n * U, 9_990n * W, BLOCK - 50n, 36);
    const loss = conversionLoss([
      paidUsdt(ANA, 6n * U, 10_000n * W, BLOCK - 100n, 30),
      conversion(6n * U, 9_997n * W, BLOCK - 90n, 31),
      paidUsdt(BETO, 6n * U, 10_000n * W, BLOCK - 80n, 32),
      memberReplaced(ANA, OUTSIDER, BLOCK - 70n, 33),
      memberReplaced(BETO, DIEGO, BLOCK - 60n, 34),
      later,
    ]);
    expect(loss.byMember).toEqual(
      new Map([
        [OUTSIDER, 3n * W],
        [DIEGO, 10n * W],
      ]),
    );
    expect(loss.byConversion.get(key(later))?.members).toEqual([DIEGO]);
  });

  it("drops a member who leaves: their loss, and their share of the USDT waiting goes to nobody", () => {
    const removed: FundEvent = { eventName: "MemberRemoved", args: { member: ANA, currencyReturned: 0n, dollarReturned: 3n * U }, ...at(BLOCK - 70n, 34) };
    const conv = conversion(9n * U, 14_970n * W, BLOCK - 60n, 35);
    const loss = conversionLoss([
      paidUsdt(ANA, 6n * U, 10_000n * W, BLOCK - 100n, 30),
      conversion(6n * U, 9_997n * W, BLOCK - 95n, 31),
      paidUsdt(ANA, 6n * U, 10_000n * W, BLOCK - 90n, 32),
      paidUsdt(BETO, 6n * U, 10_000n * W, BLOCK - 80n, 33),
      removed,
      conv,
    ]);
    expect(loss.byMember).toEqual(new Map([[BETO, 15n * W]]));
    expect(loss.byConversion.get(key(conv))).toEqual({ difference: 15n * W, members: [BETO] });
  });

  it("takes out exactly what a member who leaves took, with uneven amounts waiting, so no speck is left to a later conversion", () => {
    // 6,000000 and 6,000001 USDT waiting, 3 USDT returned: floored shares would leave a micro-USDT the fund no longer
    // holds, and each later conversion would take it first, naming two members where there was one.
    const all = conversion(9_000_001n, 15_000n * W, BLOCK - 60n, 35);
    const later = conversion(6n * U, 9_994n * W, BLOCK - 40n, 37);
    const loss = conversionLoss([
      paidUsdt(BETO, 6_000_000n, 10_000n * W, BLOCK - 90n, 31),
      paidUsdt(CARLA, 6_000_001n, 10_000n * W, BLOCK - 80n, 32),
      { eventName: "MemberRemoved", args: { member: ANA, currencyReturned: 0n, dollarReturned: 3n * U }, ...at(BLOCK - 70n, 33) },
      all,
      paidUsdt(DIEGO, 6n * U, 10_000n * W, BLOCK - 50n, 36),
      later,
    ]);
    expect(loss.byConversion.get(key(all))?.members).toEqual([BETO, CARLA]);
    expect(loss.byConversion.get(key(later))).toEqual({ difference: 6n * W, members: [DIEGO] });
  });
});

describe("closeShares", () => {
  it("splits both balances in proportion to contributions, and measures how uneven they are", () => {
    const fund = fundSnapshot({
      contributed: [50_000n * WARS_UNIT, 30_000n * WARS_UNIT, 20_000n * WARS_UNIT],
      totalContributed: 100_000n * WARS_UNIT,
      currencyBalance: 40_000n * WARS_UNIT,
      dollarBalance: 10n * USDT_UNIT,
    });
    const { shares, spread } = closeShares(fund);
    expect(shares.map((s) => [s.currency, s.dollar])).toEqual([
      [20_000n * WARS_UNIT, 5n * USDT_UNIT],
      [12_000n * WARS_UNIT, 3n * USDT_UNIT],
      [8_000n * WARS_UNIT, 2n * USDT_UNIT],
    ]);
    expect(spread).toBe(30_000n * WARS_UNIT);
  });

  it("splits equally when no one contributed, like the contract", () => {
    const fund = fundSnapshot({ contributed: [0n, 0n, 0n], totalContributed: 0n, currencyBalance: 9n, dollarBalance: 3n });
    expect(closeShares(fund).shares.map((s) => [s.currency, s.dollar])).toEqual([
      [3n, 1n],
      [3n, 1n],
      [3n, 1n],
    ]);
  });
});

describe("weekSummary: the photo of a week that closed (spec, 9.4)", () => {
  const WEEK = 604_800n;
  /** fundSnapshot() is read at BLOCK, the last block of its week 2: with one block a second, this is the first. */
  const FIRST = BLOCK - WEEK + 1n;
  const weekOf = (event: FundEvent) => (event.blockNumber >= FIRST ? 2n : event.blockNumber >= FIRST - WEEK ? 1n : 0n);
  const at = (block: bigint, tx: number, logIndex = 0) => ({ blockNumber: block, transactionHash: pad(toHex(tx), { size: 32 }) as Hash, logIndex });
  const contribution = (member: Address, credited: bigint, block: bigint, tx: number): FundEvent => ({
    eventName: "Contribution",
    args: { member, token: OUTSIDER, amount: credited, credited: credited },
    ...at(block, tx),
  });
  const proposal = (id: bigint, a: Address, amount: bigint, note: string, block: bigint, tx: number): FundEvent => ({
    eventName: "ProposalCreated",
    args: { id, action: 0, a, b: OUTSIDER, amount, proposer: ANA, note },
    ...at(block, tx),
  });
  const payment = (member: Address, amount: bigint, block: bigint, tx: number, logIndex: number): FundEvent => ({
    eventName: "Payment",
    args: { member, amount },
    ...at(block, tx, logIndex),
  });
  const executed = (id: bigint, block: bigint, tx: number, logIndex: number): FundEvent => ({
    eventName: "ProposalExecuted",
    args: { id },
    ...at(block, tx, logIndex),
  });
  const summary = (fund = fundSnapshot(), events: FundEvent[] = []) =>
    weekSummary({ fund, balance: 85_000n * WARS_UNIT, weeklyFee: FEE, events, first: FIRST, weekOf });

  it("takes what converting a member's USDT lost off what they put in (conversion-loss design)", () => {
    const facts = summary(fundSnapshot(), [
      { eventName: "Contribution", args: { member: CARLA, token: USDT, amount: 6n * USDT_UNIT, credited: 10_000n * WARS_UNIT }, ...at(FIRST + 10n, 40) },
      { eventName: "Conversion", args: { dollarIn: 6n * USDT_UNIT, currencyOut: 9_940n * WARS_UNIT }, ...at(FIRST + 20n, 41) },
    ]);
    expect(facts.dues).toEqual([
      { member: ANA, owed: 0n },
      { member: BETO, owed: 0n },
      { member: CARLA, owed: 60n * WARS_UNIT },
    ]);
  });

  it("adds up the week's contributions and lists its reimbursements and payments, each payment with its proposal's note", () => {
    const facts = summary(fundSnapshot(), [
      contribution(ANA, 10_000n * WARS_UNIT, FIRST - 5n, 10), // week 1's: not in this summary
      proposal(0n, CARLA, 8_000n * WARS_UNIT, "las pelotas", FIRST - 100n, 11), // proposed the week before
      proposal(1n, BETO, 3_000n * WARS_UNIT, "el asado", FIRST + 5n, 12),
      contribution(BETO, 10_000n * WARS_UNIT, FIRST + 10n, 13),
      contribution(CARLA, 10_050n * WARS_UNIT, FIRST + 20n, 14),
      reimbursed(ANA, 45_000n * WARS_UNIT, ref(1), FIRST + 30n, 15),
      // Both executed in one transaction (a batch): each payment goes with the execution that follows it.
      payment(CARLA, 8_000n * WARS_UNIT, FIRST + 40n, 16, 0),
      executed(0n, FIRST + 40n, 16, 1),
      payment(BETO, 3_000n * WARS_UNIT, FIRST + 40n, 16, 2),
      executed(1n, FIRST + 40n, 16, 3),
      converted(5n * USDT_UNIT, FIRST + 50n, 17), // the group doesn't need it: left out
    ]);
    expect(facts).toEqual({
      week: 2n,
      block: BLOCK,
      startsAt: 1_791_000_000n + 2n * WEEK,
      endsAt: 1_791_000_000n + 3n * WEEK,
      balance: 85_000n * WARS_UNIT,
      dues: [
        { member: ANA, owed: 0n },
        { member: BETO, owed: 0n },
        { member: CARLA, owed: 0n },
      ],
      contributed: 20_050n * WARS_UNIT,
      reimbursements: [{ member: ANA, amount: 45_000n * WARS_UNIT }],
      payments: [
        { member: CARLA, amount: 8_000n * WARS_UNIT, note: "las pelotas", givenBack: false },
        { member: BETO, amount: 3_000n * WARS_UNIT, note: "el asado", givenBack: false },
      ],
      joined: [],
    });
  });

  it("takes what was given back off the dues, and tells the payments that gave a contribution back (spec, 7.3)", () => {
    // Everyone put in the three fees by week 2, and proposal 4 gave Carla 10.000 back in the same batch as the pitch.
    const fund = fundSnapshot({ contributed: [30_000n * WARS_UNIT, 30_000n * WARS_UNIT, 30_000n * WARS_UNIT] });
    const events = [
      proposal(3n, BETO, 80_000n * WARS_UNIT, "la cancha", FIRST + 5n, 12),
      proposal(4n, CARLA, 10_000n * WARS_UNIT, "deposité en otro fondo", FIRST + 6n, 13),
      payment(BETO, 80_000n * WARS_UNIT, FIRST + 40n, 16, 0),
      executed(3n, FIRST + 40n, 16, 1),
      payment(CARLA, 10_000n * WARS_UNIT, FIRST + 40n, 16, 2),
      executed(4n, FIRST + 40n, 16, 3),
    ];
    const facts = (giveBacks?: ReadonlySet<bigint>) =>
      weekSummary({ fund, balance: 0n, weeklyFee: FEE, events, first: FIRST, weekOf, ...(giveBacks === undefined ? {} : { giveBacks }) });
    expect(facts(new Set([4n])).payments).toEqual([
      { member: BETO, amount: 80_000n * WARS_UNIT, note: "la cancha", givenBack: false },
      { member: CARLA, amount: 10_000n * WARS_UNIT, note: "deposité en otro fondo", givenBack: true },
    ]);
    expect(facts(new Set([4n])).dues.map((d) => d.owed)).toEqual([0n, 0n, 10_000n * WARS_UNIT]);
    expect(facts().dues.map((d) => d.owed)).toEqual([0n, 0n, 0n]); // with no proposal marked, a payment is a payment
  });

  it("keeps who owes in a week where nothing happened", () => {
    const facts = summary(fundSnapshot({ contributed: [30_000n * WARS_UNIT, 20_000n * WARS_UNIT, 30_000n * WARS_UNIT] }), [
      contribution(ANA, 10_000n * WARS_UNIT, FIRST - 5n, 10),
    ]);
    expect(facts).toMatchObject({ contributed: 0n, reimbursements: [], payments: [], joined: [] });
    expect(facts.dues).toEqual([
      { member: ANA, owed: 0n },
      { member: BETO, owed: 10_000n * WARS_UNIT },
      { member: CARLA, owed: 0n },
    ]);
  });

  it("says who joined in the week, and charges them that whole week only", () => {
    const fund = fundSnapshot({ members: [...MEMBERS, OUTSIDER], contributed: [30_000n * WARS_UNIT, 30_000n * WARS_UNIT, 30_000n * WARS_UNIT, 0n] });
    const facts = summary(fund, [memberAdded(OUTSIDER, FIRST + 100n)]);
    expect(facts.joined).toEqual([OUTSIDER]);
    expect(facts.dues.at(-1)).toEqual({ member: OUTSIDER, owed: FEE });
  });

  it("owes nothing to whoever paid ahead", () => {
    const facts = summary(fundSnapshot({ contributed: [50_000n * WARS_UNIT, 30_000n * WARS_UNIT, 30_000n * WARS_UNIT] }));
    expect(facts.dues.map((d) => d.owed)).toEqual([0n, 0n, 0n]);
  });
});
