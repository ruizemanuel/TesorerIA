import { type Address, type Hash, pad, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { FundEvent } from "../src/events";
import { closeShares, joinWeeks, memberDues, weekSummary } from "../src/remind";
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
        { member: CARLA, amount: 8_000n * WARS_UNIT, note: "las pelotas" },
        { member: BETO, amount: 3_000n * WARS_UNIT, note: "el asado" },
      ],
      joined: [],
    });
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
