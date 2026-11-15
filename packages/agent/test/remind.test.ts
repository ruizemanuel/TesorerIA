import { type Address, type Hash, pad, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { FundEvent } from "../src/events";
import { closeShares, givenBack, joinWeeks, memberDues, weekSummary } from "../src/remind";
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

  it("owes nothing under a centavo, as when a contribution in USDT was credited to the wei and the rest paid as shown", () => {
    // The real fund, 12/10: 5 USDT credited as 8,034.2278… wARS, then the $ 1.965,77 the screen showed.
    const credited = 8_034_227_833_761_027_780_166n;
    const shown = 1_965_770_000_000_000_000_000n;
    const centavo = WARS_UNIT / 100n;
    const owed = (contributed: bigint) => memberDues({ fund: fundSnapshot({ week: 0n, contributed: [contributed, 0n, 0n] }), weeklyFee: FEE, joined: new Map() })[0]?.owed;
    expect(owed(credited + shown)).toBe(0n);
    expect(owed(FEE - centavo + 1n)).toBe(0n);
    expect(owed(FEE - centavo)).toBe(centavo);
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
    const removed: FundEvent = { eventName: "MemberRemoved", args: { member: BETO, warsReturned: 0n, usdtReturned: 0n }, ...at(BLOCK - 10n, 23, 0) };
    expect(givenBack([...back, memberReplaced(CARLA, OUTSIDER, BLOCK - 20n, 22), removed], new Set([4n, 5n]))).toEqual(new Map([[OUTSIDER, 10_000n * WARS_UNIT]]));
  });
});

describe("closeShares", () => {
  it("splits both balances in proportion to contributions, and measures how uneven they are", () => {
    const fund = fundSnapshot({
      contributed: [50_000n * WARS_UNIT, 30_000n * WARS_UNIT, 20_000n * WARS_UNIT],
      totalContributed: 100_000n * WARS_UNIT,
      warsBalance: 40_000n * WARS_UNIT,
      usdtBalance: 10n * USDT_UNIT,
    });
    const { shares, spread } = closeShares(fund);
    expect(shares.map((s) => [s.wars, s.usdt])).toEqual([
      [20_000n * WARS_UNIT, 5n * USDT_UNIT],
      [12_000n * WARS_UNIT, 3n * USDT_UNIT],
      [8_000n * WARS_UNIT, 2n * USDT_UNIT],
    ]);
    expect(spread).toBe(30_000n * WARS_UNIT);
  });

  it("splits equally when no one contributed, like the contract", () => {
    const fund = fundSnapshot({ contributed: [0n, 0n, 0n], totalContributed: 0n, warsBalance: 9n, usdtBalance: 3n });
    expect(closeShares(fund).shares.map((s) => [s.wars, s.usdt])).toEqual([
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
    args: { member, token: OUTSIDER, amount: credited, creditedWars: credited },
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
