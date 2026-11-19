import { type FundEvent, RPC_LOG_RANGE, USDT, WARS as WARS_TOKEN } from "@tesoreria/agent";
import { type Address, getAddress, pad, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { HistoryGapError, checkHistory, completeHistory } from "../src/lib/read-fund";
import { AGENT, ANA, BETO, BLOCK, CARO, MEMBERS, USDT_UNIT, WARS, event, snapshot } from "./support/fixtures";

const DIEGO = getAddress("0x000000000000000000000000000000000000aaa4");
const EVA = getAddress("0x000000000000000000000000000000000000aaa5");

const paidIn = (member: Address, amount: bigint, block: bigint) =>
  event("Contribution", { member, token: WARS_TOKEN, amount, credited: amount }, block);
/** What snapshot()'s members put in: 30,000 wARS each. */
const contributions = MEMBERS.map((member, i) => paidIn(member, 30_000n * WARS, BLOCK - 900_000n + BigInt(i)));

describe("checkHistory", () => {
  const paid = (amount: bigint, week: bigint, n: number) =>
    event("Reimbursement", { member: n % 2 ? ANA : BETO, amount, ref: pad(`0x0${n}`, { size: 32 }), week }, BLOCK - BigInt(n));

  it("accepts a history whose reimbursements this week add up to the contract's spentInWeek", () => {
    expect(() =>
      checkHistory(snapshot({ spentThisWeek: 45_000n * WARS }), [...contributions, paid(30_000n * WARS, 1n, 1), paid(45_000n * WARS, 2n, 2)]),
    ).not.toThrow();
    expect(() => checkHistory(snapshot(), contributions)).not.toThrow();
  });

  it("stops on a history that misses a reimbursement", () => {
    expect(() => checkHistory(snapshot({ spentThisWeek: 45_000n * WARS }), contributions)).toThrow(HistoryGapError);
  });

  it("stops on a history that misses a contribution", () => {
    // 3/11: Blockscout's index of logs by address stopped a day behind, and two contributions weren't in the history.
    expect(() => checkHistory(snapshot(), contributions.slice(1))).toThrow(HistoryGapError);
  });

  it("follows what a replaced member put in to who took their place, and leaves out a member who left", () => {
    const history = [
      paidIn(DIEGO, 30_000n * WARS, BLOCK - 900n),
      paidIn(BETO, 30_000n * WARS, BLOCK - 800n),
      paidIn(CARO, 20_000n * WARS, BLOCK - 700n),
      event("MemberAdded", { member: EVA }, BLOCK - 600n),
      paidIn(EVA, 5_000n * WARS, BLOCK - 500n),
      event("MemberReplaced", { oldMember: DIEGO, newMember: ANA }, BLOCK - 400n),
      event("MemberRemoved", { member: EVA, currencyReturned: 5_000n * WARS, dollarReturned: 0n }, BLOCK - 300n),
      paidIn(CARO, 10_000n * WARS, BLOCK - 200n),
    ];
    expect(() => checkHistory(snapshot(), history)).not.toThrow();
  });

  it("stops on a history that misses a conversion, by the fund's USDT (conversion-loss design)", () => {
    // Ana put her 30.000 in as 18 USDT; Beto and Caro in wARS.
    const usdtIn = event("Contribution", { member: ANA, token: USDT, amount: 18n * USDT_UNIT, credited: 30_000n * WARS }, BLOCK - 900_000n);
    const paid = [usdtIn, ...contributions.slice(1)];
    const converted = event("Conversion", { dollarIn: 18n * USDT_UNIT, currencyOut: 29_990n * WARS }, BLOCK - 800_000n);
    expect(() => checkHistory(snapshot({ dollarBalance: 0n }), paid)).toThrow(HistoryGapError);
    expect(() => checkHistory(snapshot({ dollarBalance: 18n * USDT_UNIT }), paid)).not.toThrow(); // still waiting
    expect(() => checkHistory(snapshot({ dollarBalance: 0n }), [...paid, converted])).not.toThrow();
    expect(() => checkHistory(snapshot({ dollarBalance: 5n * USDT_UNIT }), [...paid, converted])).not.toThrow(); // sent straight to the fund
  });

  it("takes out the USDT that closing split and a member who left took", () => {
    const paid = [event("Contribution", { member: ANA, token: USDT, amount: 18n * USDT_UNIT, credited: 30_000n * WARS }, BLOCK - 900_000n), ...contributions.slice(1)];
    const out = (e: FundEvent) => checkHistory(snapshot({ dollarBalance: 0n }), [...paid, e]);
    expect(() => out(event("FundClosed", { currencyBalance: 60_000n * WARS, dollarBalance: 18n * USDT_UNIT }, BLOCK - 100n))).not.toThrow();
    expect(() => out(event("RemainderDistributed", { currencyBalance: 0n, dollarBalance: 18n * USDT_UNIT }, BLOCK - 100n))).not.toThrow();
    expect(() => out(event("MemberRemoved", { member: DIEGO, currencyReturned: 0n, dollarReturned: 18n * USDT_UNIT }, BLOCK - 100n))).not.toThrow();
  });

  describe("in version 2", () => {
    /** Version 2's events: a dollar contribution waits, credited with nothing, until a conversion credits it. */
    const dollarIn = (member: Address, amount: bigint, block: bigint) => event("Contribution", { member, token: USDT, amount, credited: 0n }, block);
    /** One member's part of a swap: what it gave before the fee (`currencyOut`), and what it credited them. */
    const convertedFor = (member: Address, dollars: bigint, credited: bigint, block: bigint) =>
      event("Conversion", { member, dollarIn: dollars, currencyOut: (credited * 10_000n) / 9_975n, credited }, block);
    const givenBack = (member: Address, amount: bigint, block: bigint) => event("ContributionGivenBack", { member, amount }, block);
    /**
     * Ana put in 30.000 in pesos (29.925 once the fee was set aside). Diego sent 18 USDT, converted into 29.900 credited,
     * and Beto took his place, with them; then the group gave Beto 4.900 back. Eva joined, sent 3 USDT and was removed
     * with them. Caro put in 20.000 credited, and her 6 USDT are still pending.
     */
    const history = [
      event("Contribution", { member: ANA, token: WARS_TOKEN, amount: 30_000n * WARS, credited: 29_925n * WARS }, BLOCK - 900n),
      dollarIn(DIEGO, 18n * USDT_UNIT, BLOCK - 850n),
      convertedFor(DIEGO, 18n * USDT_UNIT, 29_900n * WARS, BLOCK - 800n),
      event("MemberReplaced", { oldMember: DIEGO, newMember: BETO }, BLOCK - 750n),
      givenBack(BETO, 4_900n * WARS, BLOCK - 700n),
      event("MemberAdded", { member: EVA }, BLOCK - 650n),
      dollarIn(EVA, 3n * USDT_UNIT, BLOCK - 600n),
      event("MemberRemoved", { member: EVA, currencyReturned: 0n, dollarReturned: 3n * USDT_UNIT }, BLOCK - 550n),
      paidIn(CARO, 20_000n * WARS, BLOCK - 500n),
      dollarIn(CARO, 6n * USDT_UNIT, BLOCK - 400n),
    ];
    const v2 = (change: Parameters<typeof snapshot>[0] = {}) =>
      snapshot({
        version: 2,
        feeBps: 25,
        contributed: [29_925n * WARS, 25_000n * WARS, 20_000n * WARS],
        totalContributed: 74_925n * WARS,
        pendingDollar: [0n, 0n, 6n * USDT_UNIT],
        pendingValue: [0n, 0n, 10_020n * WARS],
        totalPendingDollar: 6n * USDT_UNIT,
        dollarBalance: 6n * USDT_UNIT,
        ...change,
      });

    it("a v2 history adds up with conversions, give-backs and pending dollars", () => {
      expect(() => checkHistory(v2(), history)).not.toThrow();
      // Caro's pending dollars are counted too: one more than the contract says is a hole.
      expect(() => checkHistory(v2({ pendingDollar: [0n, 0n, 5n * USDT_UNIT] }), history)).toThrow(HistoryGapError);
    });

    it("a v2 history moves a replaced member's pending dollars to who took their place", () => {
      // Diego sent 18 USDT and was replaced by Beto before they were converted: the contract has them pending for Beto.
      const replaced = [
        event("Contribution", { member: ANA, token: WARS_TOKEN, amount: 30_000n * WARS, credited: 29_925n * WARS }, BLOCK - 900n),
        dollarIn(DIEGO, 18n * USDT_UNIT, BLOCK - 850n),
        event("MemberReplaced", { oldMember: DIEGO, newMember: BETO }, BLOCK - 750n),
        paidIn(CARO, 20_000n * WARS, BLOCK - 500n),
      ];
      const pendingForBeto = v2({
        contributed: [29_925n * WARS, 0n, 20_000n * WARS],
        totalContributed: 49_925n * WARS,
        pendingDollar: [0n, 18n * USDT_UNIT, 0n],
        pendingValue: [0n, 30_060n * WARS, 0n],
        totalPendingDollar: 18n * USDT_UNIT,
        dollarBalance: 18n * USDT_UNIT,
      });
      expect(() => checkHistory(pendingForBeto, replaced)).not.toThrow();
      // Converted later, they're credited to Beto, and nothing is pending.
      const converted = [...replaced, convertedFor(BETO, 18n * USDT_UNIT, 29_900n * WARS, BLOCK - 400n)];
      const creditedToBeto = v2({
        contributed: [29_925n * WARS, 29_900n * WARS, 20_000n * WARS],
        totalContributed: 79_825n * WARS,
        pendingDollar: [0n, 0n, 0n],
        pendingValue: [0n, 0n, 0n],
        totalPendingDollar: 0n,
        dollarBalance: 0n,
      });
      expect(() => checkHistory(creditedToBeto, converted)).not.toThrow();
    });

    it("a v2 history missing a Conversion has a hole", () => {
      expect(() => checkHistory(v2(), history.filter((e) => e.eventName !== "Conversion"))).toThrow(HistoryGapError);
    });

    it("a dollar sent straight to a v2 fund is no hole", () => {
      // 5 USDT that came in without contributeDollar: they're nobody's, and only add to what the fund holds.
      expect(() => checkHistory(v2({ dollarBalance: 11n * USDT_UNIT }), history)).not.toThrow();
      // Holding less than what members have pending can't be.
      expect(() => checkHistory(v2({ dollarBalance: 5n * USDT_UNIT }), history)).toThrow(HistoryGapError);
    });

    it("a closed v2 fund that returned pending dollars adds up", () => {
      // The close gave Caro her 6 USDT back with no event of hers: FundClosed is what says so.
      const closed = event("FundClosed", { currencyBalance: 70_025n * WARS, dollarBalance: 6n * USDT_UNIT }, BLOCK - 100n);
      const after = v2({ closed: true, pendingDollar: [0n, 0n, 0n], pendingValue: [0n, 0n, 0n], totalPendingDollar: 0n, dollarBalance: 0n });
      expect(() => checkHistory(after, [...history, closed])).not.toThrow();
      expect(() => checkHistory(after, history)).toThrow(HistoryGapError);
    });
  });

  it("stops on a history that misses a proposal", () => {
    const proposal = event(
      "ProposalCreated",
      { id: 0n, action: 0, a: ANA, b: zeroAddress, amount: 1_000n * WARS, proposer: AGENT, note: "carne" },
      BLOCK - 5n,
    );
    expect(() => checkHistory(snapshot({ proposalCount: 1n }), [...contributions, proposal])).not.toThrow();
    expect(() => checkHistory(snapshot({ proposalCount: 1n }), contributions)).toThrow(HistoryGapError);
  });
});

describe("completeHistory", () => {
  /** A node that answers any range of `all`, and keeps the ranges it was asked for. */
  function nodeOf(all: readonly FundEvent[]) {
    const asked: [bigint, bigint][] = [];
    const node = async (fromBlock: bigint, toBlock: bigint) => {
      asked.push([fromBlock, toBlock]);
      return all.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
    };
    return { node, asked };
  }

  it("gives back a history that adds up as it came, without asking the node", async () => {
    const { node, asked } = nodeOf(contributions);
    expect(await completeHistory({ snapshot: snapshot(), events: contributions, fromBlock: BLOCK - 1_000_000n, node })).toEqual(contributions);
    expect(asked).toEqual([]);
  });

  it("fills a hole from the node, back from the snapshot's block only as far as the history needs", async () => {
    // Blockscout misses CARO's contribution, 150,003 blocks back: the node's first 100,000 blocks don't have it, the next ones do.
    // (Blocks apart by other than a multiple of 100,000: event() names the transaction after the block's last digits.)
    const conversion = event("Conversion", { dollarIn: 6_060_000n, currencyOut: 9_996n * WARS }, BLOCK - 10n);
    const all = [
      paidIn(ANA, 30_000n * WARS, BLOCK - 900_001n),
      paidIn(BETO, 30_000n * WARS, BLOCK - 800_002n),
      paidIn(CARO, 30_000n * WARS, BLOCK - 150_003n),
      conversion,
    ];
    const { node, asked } = nodeOf(all);

    const events = await completeHistory({ snapshot: snapshot(), events: [all[0]!, all[1]!, conversion], fromBlock: BLOCK - 1_000_000n, node });

    // In chain order, with one copy of what both readers had.
    expect(events).toEqual(all);
    expect(asked.every(([from, to]) => to - from + 1n <= RPC_LOG_RANGE)).toBe(true);
    expect(asked.reduce((oldest, [from]) => (from < oldest ? from : oldest), BLOCK)).toBe(BLOCK - 200_000n + 1n);
    expect(asked.reduce((newest, [, to]) => (to > newest ? to : newest), 0n)).toBe(BLOCK);
  });

  it("stops on a hole that the node's whole history doesn't fill", async () => {
    const { node, asked } = nodeOf(contributions.slice(1));
    await expect(completeHistory({ snapshot: snapshot(), events: contributions.slice(1), fromBlock: BLOCK - 250_000n, node })).rejects.toThrow(
      HistoryGapError,
    );
    // Down to the fund's first block, and not one before.
    expect(asked.reduce((oldest, [from]) => (from < oldest ? from : oldest), BLOCK)).toBe(BLOCK - 250_000n);
  });
});
