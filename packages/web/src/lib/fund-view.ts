import { type FundSnapshot, memberDues } from "@tesoreria/agent";
import { type Address, getAddress } from "viem";

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
  rows: MemberRow[];
  /** The viewer's own numbers, when they're a member: what they owe, and their part if it closed today. */
  me: { owed: bigint; share: bigint } | null;
};

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
}: {
  snapshot: FundSnapshot;
  name: string;
  agreedExpense: string;
  balance: bigint;
  weeklyFee: bigint;
  /** The week each member joined, from joinWeeks; founders are left out (week 0). */
  joined: ReadonlyMap<Address, bigint>;
  /** First names by checksummed account; a member without one shows as "Miembro N". */
  names: ReadonlyMap<Address, string>;
  viewer: Address | null;
}): FundView {
  const me = viewer === null ? null : getAddress(viewer);
  const rows = memberDues({ fund: snapshot, weeklyFee, joined }).map(({ member, owed }, i) => {
    const address = getAddress(member);
    return { position: i + 1, member: address, name: names.get(address) ?? `Miembro ${i + 1}`, isMe: address === me, owed };
  });
  const mine = rows.find((row) => row.isMe);
  let share = 0n;
  if (mine !== undefined) {
    // Fund._split pays each token in proportion to what each contributed (equal parts if no one did):
    // in pesos, that's the balance times the member's part.
    const contributed = snapshot.contributed[mine.position - 1] ?? 0n;
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
    rows,
    me: mine === undefined ? null : { owed: mine.owed, share },
  };
}
