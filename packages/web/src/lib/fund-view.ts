import { type FundSnapshot, type FundVersion, memberDues } from "@tesoreria/agent";
import { type Address, getAddress } from "viem";
import type { Messages } from "./i18n/messages";

export type MemberRow = {
  /** 1-based, in the contract's order: the founders as they joined, then whoever was added. */
  position: number;
  member: Address;
  name: string;
  isMe: boolean;
  /** What they still owe of their weekly fees through this week; 0 is "pagó" (spec, 9.2). */
  owed: bigint;
};

export type FundView = {
  address: Address;
  name: string;
  agreedExpense: string;
  closed: boolean;
  /**
   * Everything the fund holds, in its currency, its dollars valued at the pool's TWAP (readBalance): version 1's
   * balanceInWars, version 2's balanceInCurrency.
   */
  balance: bigint;
  /** The fund's contract version, and the currency and the dollar it takes (version 1: wARS and USDT). */
  version: FundVersion;
  currency: Address;
  dollar: Address | null;
  /** What each contribution leaves for the fund's operations, in basis points (FundV2.feeBps): 0 in version 1. */
  feeBps: number;
  /** The most the contract lets the fund hold, as it counts it (`counted`). */
  balanceCap: bigint;
  /**
   * What the contract counts toward `balanceCap`: version 1's whole balance; version 2's available currency and every
   * member's pending dollars at their TWAP value, without the dollars sent to it directly, which are nobody's. Never
   * less than the contract's count: FundV2 floors the value of all the pending dollars at once, and each member's
   * `pendingValue` is floored on its own, so their sum can be up to a wei low for each member with dollars pending but
   * one, and that much more is counted.
   */
  counted: bigint;
  weeklyFee: bigint;
  weeklyCap: bigint;
  spentThisWeek: bigint;
  leftThisWeek: bigint;
  votesRequired: number;
  /** The contract's week, counted from 0: (timestamp - startTime) / WEEK. */
  week: bigint;
  rows: MemberRow[];
  /**
   * The viewer's own numbers, when they're a member: what they owe, what they paid ahead of this week (when it's worth
   * saying, AHEAD_SAID_FROM_BPS), and their part if it closed today.
   */
  me: { owed: bigint; ahead: bigint; share: bigint } | null;
};

/**
 * Paid ahead under this part of a weekly fee (1 %) isn't said: it's what's left of the margin Aportar adds to USDT
 * (USDT_MARGIN_BPS, 0,3 %) after its conversion, and its cents, not money put in ahead.
 */
const AHEAD_SAID_FROM_BPS = 100n;

/** The inicio's numbers (spec, 9.2), from a fund's snapshot and what lives off chain. */
export function buildFundView({
  snapshot,
  name,
  agreedExpense,
  balance,
  weeklyFee,
  joined,
  givenBack = new Map(),
  conversionLoss = new Map(),
  names,
  viewer,
  m,
}: {
  snapshot: FundSnapshot;
  name: string;
  agreedExpense: string;
  balance: bigint;
  weeklyFee: bigint;
  /** The week each member joined, from joinWeeks; founders are left out (week 0). */
  joined: ReadonlyMap<Address, bigint>;
  /**
   * Version 1: what each member was given back of their contributions (givenBack, spec 7.3): it doesn't count as paid
   * ahead. Version 2's contract already takes it off what they contributed (memberDues ignores it).
   */
  givenBack?: ReadonlyMap<Address, bigint>;
  /** Version 1: what converting each member's USDT lost, negative if it gained (conversionLoss): it doesn't count as put in either. */
  conversionLoss?: ReadonlyMap<Address, bigint>;
  /** First names by checksummed account; a member without one shows as "Miembro N" ("Member N" in English). */
  names: ReadonlyMap<Address, string>;
  viewer: Address | null;
  /** The page's dictionary, for that name. */
  m: Messages;
}): FundView {
  const me = viewer === null ? null : getAddress(viewer);
  const dues = memberDues({ fund: snapshot, weeklyFee, joined, givenBack, conversionLoss });
  const rows = dues.map(({ member, owed }, i) => {
    const address = getAddress(member);
    return { position: i + 1, member: address, name: names.get(address) ?? m.common.member(i + 1), isMe: address === me, owed };
  });
  const mine = rows.find((row) => row.isMe);
  // Every member's pending dollars at their TWAP value: only version 2 holds them apart until they're converted.
  const pending = snapshot.version === 2 ? snapshot.pendingValue.reduce((sum, value) => sum + value, 0n) : 0n;
  // What flooring each member's value apart can leave out of the contract's count (`counted`): a wei for each but one.
  const pendingMembers = snapshot.version === 2 ? snapshot.pendingDollar.filter((dollars) => dollars > 0n).length : 0;
  const flooredApart = BigInt(Math.max(0, pendingMembers - 1));
  let share = 0n;
  let ahead = 0n;
  if (mine !== undefined) {
    const { due, contributed } = dues[mine.position - 1]!;
    const over = contributed > due ? contributed - due : 0n;
    ahead = over * 10_000n >= weeklyFee * AHEAD_SAID_FROM_BPS ? over : 0n;
    // Fund._split pays each token in proportion to what each contributed (equal parts if no one did): in pesos, that's
    // the balance times the member's part. The contract's count, with what was given back still in it in version 1
    // (spec, 7.3). FundV2._split first gives each member their own pending dollars back, whole, and splits the rest
    // that way: the balance less everyone's pending dollars at their TWAP value.
    const i = mine.position - 1;
    const counted = snapshot.contributed[i] ?? 0n;
    const rest = balance > pending ? balance - pending : 0n;
    const own = snapshot.version === 2 ? (snapshot.pendingValue[i] ?? 0n) : 0n;
    share =
      (snapshot.totalContributed === 0n ? rest / BigInt(snapshot.members.length) : (rest * counted) / snapshot.totalContributed) + own;
  }
  return {
    address: snapshot.address,
    name,
    agreedExpense,
    closed: snapshot.closed,
    balance,
    version: snapshot.version,
    currency: snapshot.currency,
    dollar: snapshot.dollar,
    feeBps: snapshot.feeBps,
    balanceCap: snapshot.balanceCap,
    counted: snapshot.version === 2 ? snapshot.currencyBalance + pending + flooredApart : balance,
    weeklyFee,
    weeklyCap: snapshot.weeklyCap,
    spentThisWeek: snapshot.spentThisWeek,
    leftThisWeek: snapshot.weeklyCap > snapshot.spentThisWeek ? snapshot.weeklyCap - snapshot.spentThisWeek : 0n,
    votesRequired: snapshot.votesRequired,
    week: snapshot.week,
    rows,
    me: mine === undefined ? null : { owed: mine.owed, ahead, share },
  };
}
