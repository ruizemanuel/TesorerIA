import { type Address, getAddress } from "viem";
import type { FundEvent } from "./events";
import { type FundSnapshot, WEEK } from "./fund";

/**
 * The week each member joined, from the fund's events: the founders in week 0 (left out of the map), an
 * added member in the week of its MemberAdded, and a replacement address in its predecessor's week.
 * `weekOf` gives the fund week an event happened in.
 */
export function joinWeeks(events: readonly FundEvent[], weekOf: (event: FundEvent) => bigint): Map<Address, bigint> {
  const weeks = new Map<Address, bigint>();
  for (const event of events) {
    if (event.eventName === "MemberAdded") {
      weeks.set(getAddress(event.args.member), weekOf(event));
    } else if (event.eventName === "MemberReplaced") {
      weeks.set(getAddress(event.args.newMember), weeks.get(getAddress(event.args.oldMember)) ?? 0n);
    }
  }
  return weeks;
}

/** What a member should have put in by the end of this week, what they did, and what they owe. All in wARS. */
export type MemberDues = { member: Address; due: bigint; contributed: bigint; owed: bigint };

/**
 * Less than this left to pay is nothing left: one centavo, in wARS. Amounts are shown and typed in centavos, but a
 * contribution in USDT is credited to the wei, so paying what the screen showed can leave a fraction of a centavo.
 */
export const DUES_DUST = 10n ** 16n;

/**
 * Each member's dues at `weeklyFee` per week, from the week they joined through the current one (spec, 8.1:
 * reminders). `weeklyFee` is the fund's fee, which lives off chain. Under DUES_DUST owed is nothing.
 */
export function memberDues({
  fund,
  weeklyFee,
  joined,
}: {
  fund: FundSnapshot;
  weeklyFee: bigint;
  joined: ReadonlyMap<Address, bigint>;
}): MemberDues[] {
  return fund.members.map((member, i) => {
    const weeks = fund.week - (joined.get(getAddress(member)) ?? 0n) + 1n;
    const due = weeks > 0n ? weeklyFee * weeks : 0n;
    const contributed = fund.contributed[i] ?? 0n;
    const short = due > contributed ? due - contributed : 0n;
    return { member, due, contributed, owed: short < DUES_DUST ? 0n : short };
  });
}

/** A member's part if the fund closed now. */
export type CloseShare = { member: Address; contributed: bigint; wars: bigint; usdt: bigint };

/**
 * What each member would get if the fund closed now, split like `Fund._split` does: in proportion to what
 * each contributed, or equally if no one did. `spread` is the gap between the largest and smallest
 * contribution, which the agent points out when someone proposes to close (spec, 7.3).
 */
export function closeShares(fund: FundSnapshot): { shares: CloseShare[]; spread: bigint } {
  const n = BigInt(fund.members.length);
  const total = fund.totalContributed;
  const shares = fund.members.map((member, i) => {
    const contributed = fund.contributed[i] ?? 0n;
    return {
      member,
      contributed,
      wars: total === 0n ? fund.warsBalance / n : (fund.warsBalance * contributed) / total,
      usdt: total === 0n ? fund.usdtBalance / n : (fund.usdtBalance * contributed) / total,
    };
  });
  const amounts = shares.map((s) => s.contributed);
  const max = amounts.reduce((a, b) => (b > a ? b : a), 0n);
  const min = amounts.reduce((a, b) => (b < a ? b : a), max);
  return { shares, spread: max - min };
}

/**
 * What the agent keeps of a week once it closed (spec, 9.4): read at the week's last block, so it stays the photo
 * of the close. Addresses and amounts only, never names or sentences: the web writes the text in the page's language.
 */
export type WeekSummaryFacts = {
  /** The contract's week, from 0. */
  week: bigint;
  /** The week's last block, which the snapshot and the balance were read at. */
  block: bigint;
  /** Seconds: startTime + week × WEEK, and the start of the next week. */
  startsAt: bigint;
  endsAt: bigint;
  /** balanceInWars at `block`, the same count as the inicio. */
  balance: bigint;
  /** Every member at `block`, in the contract's order, with what they owed when the week closed (memberDues). */
  dues: { member: Address; owed: bigint }[];
  /** The week's Contribution.creditedWars, added up. */
  contributed: bigint;
  reimbursements: { member: Address; amount: bigint }[];
  /** Each payment the group approved, with its proposal's note. */
  payments: { member: Address; amount: bigint; note: string }[];
  /** Who joined in the week (MemberAdded). */
  joined: Address[];
};

/**
 * The photo of the week `fund` was read in, at its last block (spec, 9.4). `events` go from the fund's creation up to
 * that block: the dues need every MemberAdded (joinWeeks, with the screen's `weekOf`), and a payment's note is in its
 * proposal, which may be older than the week. Only the events from `first` on are the week's. Conversions are left
 * out: for the group they change nothing.
 */
export function weekSummary({
  fund,
  balance,
  weeklyFee,
  events,
  first,
  weekOf,
}: {
  fund: FundSnapshot;
  balance: bigint;
  weeklyFee: bigint;
  events: readonly FundEvent[];
  first: bigint;
  weekOf: (event: FundEvent) => bigint;
}): WeekSummaryFacts {
  const dues = memberDues({ fund, weeklyFee, joined: joinWeeks(events, weekOf) }).map(({ member, owed }) => ({ member, owed }));
  const notes = new Map<bigint, string>();
  for (const event of events) if (event.eventName === "ProposalCreated") notes.set(event.args.id, event.args.note);
  const week = events.filter((event) => event.blockNumber >= first && event.blockNumber <= fund.block);
  let contributed = 0n;
  const reimbursements: WeekSummaryFacts["reimbursements"] = [];
  const payments: WeekSummaryFacts["payments"] = [];
  const joined: Address[] = [];
  for (const event of week) {
    switch (event.eventName) {
      case "Contribution":
        contributed += event.args.creditedWars;
        break;
      case "Reimbursement":
        reimbursements.push({ member: getAddress(event.args.member), amount: event.args.amount });
        break;
      case "Payment": {
        // Its proposal is the ProposalExecuted that follows it in the same transaction (Fund.execute emits it last).
        const execution = week.find(
          (other) => other.eventName === "ProposalExecuted" && other.transactionHash === event.transactionHash && other.logIndex > event.logIndex,
        );
        const id = execution?.eventName === "ProposalExecuted" ? execution.args.id : undefined;
        payments.push({ member: getAddress(event.args.member), amount: event.args.amount, note: id === undefined ? "" : (notes.get(id) ?? "") });
        break;
      }
      case "MemberAdded":
        joined.push(getAddress(event.args.member));
        break;
    }
  }
  return {
    week: fund.week,
    block: fund.block,
    startsAt: fund.startTime + fund.week * WEEK,
    endsAt: fund.startTime + (fund.week + 1n) * WEEK,
    balance,
    dues,
    contributed,
    reimbursements,
    payments,
    joined,
  };
}
