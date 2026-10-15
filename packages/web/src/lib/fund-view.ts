import { type FundSnapshot, memberDues } from "@tesoreria/agent";
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
  /** wARS plus the USDT valued at the pool's TWAP: the contract's balanceInWars. */
  balance: bigint;
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
 * Paid ahead under this part of a weekly fee (1 %) isn't said: it's the margin Aportar adds to USDT
 * (USDT_MARGIN_BPS) and its cents, not money put in ahead.
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
  /** First names by checksummed account; a member without one shows as "Miembro N" ("Member N" in English). */
  names: ReadonlyMap<Address, string>;
  viewer: Address | null;
  /** The page's dictionary, for that name. */
  m: Messages;
}): FundView {
  const me = viewer === null ? null : getAddress(viewer);
  const dues = memberDues({ fund: snapshot, weeklyFee, joined });
  const rows = dues.map(({ member, owed }, i) => {
    const address = getAddress(member);
    return { position: i + 1, member: address, name: names.get(address) ?? m.common.member(i + 1), isMe: address === me, owed };
  });
  const mine = rows.find((row) => row.isMe);
  let share = 0n;
  let ahead = 0n;
  if (mine !== undefined) {
    const { due, contributed } = dues[mine.position - 1]!;
    const over = contributed > due ? contributed - due : 0n;
    ahead = over * 10_000n >= weeklyFee * AHEAD_SAID_FROM_BPS ? over : 0n;
    // Fund._split pays each token in proportion to what each contributed (equal parts if no one did):
    // in pesos, that's the balance times the member's part.
    share =
      snapshot.totalContributed === 0n
        ? balance / BigInt(snapshot.members.length)
        : (balance * contributed) / snapshot.totalContributed;
  }
  return {
    address: snapshot.address,
    name,
    agreedExpense,
    closed: snapshot.closed,
    balance,
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
