import { type Address, getAddress } from "viem";
import type { FundEvent } from "./events";
import type { FundSnapshot } from "./fund";

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
 * Each member's dues at `weeklyFee` per week, from the week they joined through the current one (spec, 8.1:
 * reminders). `weeklyFee` is the fund's fee, which lives off chain.
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
    return { member, due, contributed, owed: due > contributed ? due - contributed : 0n };
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
