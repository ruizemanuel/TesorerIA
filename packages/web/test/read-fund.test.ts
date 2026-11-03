import { type FundEvent, RPC_LOG_RANGE, WARS as WARS_TOKEN } from "@tesoreria/agent";
import { type Address, getAddress, pad, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { HistoryGapError, checkHistory, completeHistory } from "../src/lib/read-fund";
import { AGENT, ANA, BETO, BLOCK, CARO, MEMBERS, WARS, event, snapshot } from "./support/fixtures";

const DIEGO = getAddress("0x000000000000000000000000000000000000aaa4");
const EVA = getAddress("0x000000000000000000000000000000000000aaa5");

const paidIn = (member: Address, amount: bigint, block: bigint) =>
  event("Contribution", { member, token: WARS_TOKEN, amount, creditedWars: amount }, block);
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
      event("MemberRemoved", { member: EVA, warsReturned: 5_000n * WARS, usdtReturned: 0n }, BLOCK - 300n),
      paidIn(CARO, 10_000n * WARS, BLOCK - 200n),
    ];
    expect(() => checkHistory(snapshot(), history)).not.toThrow();
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
    const conversion = event("Conversion", { usdtIn: 6_060_000n, warsOut: 9_996n * WARS }, BLOCK - 10n);
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
