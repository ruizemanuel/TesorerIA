import { type Address, getAddress, isAddressEqual } from "viem";
import { USDT } from "./chain";
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

/**
 * What a member should have put in by the end of this week, what they did (less what was given back to them and what
 * converting their USDT lost), and what they owe. All in wARS.
 */
export type MemberDues = { member: Address; due: bigint; contributed: bigint; owed: bigint };

/**
 * Less than this part of a weekly fee left to pay (0,5 %: $ 50 of $ 10.000) is no debt yet: it goes with the next
 * week's, since the dues add up every week's fee. Paying what Aportar asked must never turn into a debt of a few pesos
 * minutes later, when a conversion lost more than its margin, nor ask for a payment of a few centavos of USDT that
 * the agent wouldn't even convert (conversion-loss design).
 */
export const OWED_SAID_FROM_BPS = 50n;

/**
 * Each member's dues at `weeklyFee` per week, from the week they joined through the current one (spec, 8.1:
 * reminders). `weeklyFee` is the fund's fee, which lives off chain. What a member was given back of their
 * contributions (`givenBack`) and what converting their USDT lost (`conversionLoss`, negative when it gained), both by
 * checksummed account, don't count as put in. Under OWED_SAID_FROM_BPS of the fee owed is nothing.
 */
export function memberDues({
  fund,
  weeklyFee,
  joined,
  givenBack = new Map(),
  conversionLoss = new Map(),
}: {
  fund: FundSnapshot;
  weeklyFee: bigint;
  joined: ReadonlyMap<Address, bigint>;
  givenBack?: ReadonlyMap<Address, bigint>;
  conversionLoss?: ReadonlyMap<Address, bigint>;
}): MemberDues[] {
  return fund.members.map((member, i) => {
    const weeks = fund.week - (joined.get(getAddress(member)) ?? 0n) + 1n;
    const due = weeks > 0n ? weeklyFee * weeks : 0n;
    const gross = fund.contributed[i] ?? 0n;
    const net = gross - (givenBack.get(getAddress(member)) ?? 0n) - (conversionLoss.get(getAddress(member)) ?? 0n);
    const contributed = net > 0n ? net : 0n;
    const short = due > contributed ? due - contributed : 0n;
    return { member, due, contributed, owed: short * 10_000n < weeklyFee * OWED_SAID_FROM_BPS ? 0n : short };
  });
}

/**
 * The proposal a Payment in `events` paid: the ProposalExecuted that follows it in the same transaction (Fund.execute
 * emits it last), so each payment of a batch goes with its own.
 */
export function paidProposal(events: readonly FundEvent[], payment: FundEvent): bigint | undefined {
  const execution = events.find(
    (other) => other.eventName === "ProposalExecuted" && other.transactionHash === payment.transactionHash && other.logIndex > payment.logIndex,
  );
  return execution?.eventName === "ProposalExecuted" ? execution.args.id : undefined;
}

/**
 * What each member was given back of their contributions (spec, 7.3): the Payments of the proposals in `giveBacks`
 * (by id) that `events` executed. The contract can't lower what a member contributed, so the dues take it off. It
 * moves with a member who is replaced and goes with one who is removed, as the contract does with contributions.
 */
export function givenBack(events: readonly FundEvent[], giveBacks: ReadonlySet<bigint>): Map<Address, bigint> {
  const back = new Map<Address, bigint>();
  for (const event of events) {
    if (event.eventName === "Payment") {
      const id = paidProposal(events, event);
      if (id === undefined || !giveBacks.has(id)) continue;
      const member = getAddress(event.args.member);
      back.set(member, (back.get(member) ?? 0n) + event.args.amount);
    } else if (event.eventName === "MemberReplaced") {
      const old = getAddress(event.args.oldMember);
      const amount = back.get(old);
      back.delete(old);
      if (amount !== undefined) back.set(getAddress(event.args.newMember), amount);
    } else if (event.eventName === "MemberRemoved") {
      back.delete(getAddress(event.args.member));
    }
  }
  return back;
}

/** A conversion's USDT against what it had been credited, in wARS: positive if it brought less, and whose it was. */
export type ConversionDifference = { difference: bigint; members: Address[] };

export type ConversionLoss = {
  /** By checksummed member: what converting their USDT lost (positive) or gained (negative) against what it was credited. */
  byMember: Map<Address, bigint>;
  /** By the Conversion's `${transactionHash}:${logIndex}`, only when some of its USDT was credited to a current member. */
  byConversion: Map<string, ConversionDifference>;
};

/**
 * What converting each member's USDT got against what it was credited at (conversion-loss design). The contract credits
 * a USDT contribution at the pool's TWAP, and `convert` gets a little less (or more): the dues count what it got, so the
 * member whose USDT it was covers the difference and the fund holds what it says was put in.
 *
 * USDT is fungible, so conversions take the USDT contributions in order of arrival (the agent converts the whole balance
 * at once, so this is what happened but for its caps). Every USDT of a conversion is worth the same, `warsOut / usdtIn`,
 * whatever it was credited at. USDT that came in without `contributeUsdt` has no one to charge. A replaced member's loss
 * and USDT still waiting move to the new account; a member who leaves takes their loss with them, `usdtReturned` comes
 * out of the USDT waiting in proportion, without charging anyone, and what they left waiting is no one's.
 */
export function conversionLoss(events: readonly FundEvent[]): ConversionLoss {
  const queue: { member: Address | null; usdt: bigint; credited: bigint }[] = [];
  const byMember = new Map<Address, bigint>();
  const byConversion = new Map<string, ConversionDifference>();
  for (const event of events) {
    switch (event.eventName) {
      case "Contribution":
        if (isAddressEqual(event.args.token, USDT)) {
          queue.push({ member: getAddress(event.args.member), usdt: event.args.amount, credited: event.args.creditedWars });
        }
        break;
      case "MemberReplaced": {
        const old = getAddress(event.args.oldMember);
        const next = getAddress(event.args.newMember);
        const loss = byMember.get(old);
        byMember.delete(old);
        if (loss !== undefined) byMember.set(next, loss);
        for (const tranche of queue) if (tranche.member === old) tranche.member = next;
        break;
      }
      case "MemberRemoved": {
        const gone = getAddress(event.args.member);
        const waiting = queue.reduce((sum, tranche) => sum + tranche.usdt, 0n);
        const returned = event.args.usdtReturned;
        if (returned >= waiting) {
          queue.length = 0;
        } else if (returned > 0n) {
          // Floored shares take out a little less than `returned`: the rest comes off the latest tranches, so what waits
          // is exactly what the fund still holds and no speck is left for a later conversion to take first.
          let out = 0n;
          for (const tranche of queue) {
            const usdt = (tranche.usdt * returned) / waiting;
            tranche.credited -= (tranche.credited * returned) / waiting;
            tranche.usdt -= usdt;
            out += usdt;
          }
          for (let i = queue.length - 1; i >= 0 && out < returned; i--) {
            const tranche = queue[i]!;
            const usdt = tranche.usdt < returned - out ? tranche.usdt : returned - out;
            tranche.credited -= (tranche.credited * usdt) / tranche.usdt;
            tranche.usdt -= usdt;
            out += usdt;
          }
          for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.usdt === 0n) queue.splice(i, 1);
        }
        for (const tranche of queue) if (tranche.member === gone) tranche.member = null;
        byMember.delete(gone);
        break;
      }
      case "Conversion": {
        const { usdtIn, warsOut } = event.args;
        let left = usdtIn;
        let difference = 0n;
        const members: Address[] = [];
        while (left > 0n && queue.length > 0) {
          const head = queue[0]!;
          const take = head.usdt < left ? head.usdt : left;
          const credited = (head.credited * take) / head.usdt;
          const worth = (warsOut * take) / usdtIn;
          head.usdt -= take;
          head.credited -= credited;
          left -= take;
          if (head.usdt === 0n) queue.shift();
          if (head.member === null) continue;
          byMember.set(head.member, (byMember.get(head.member) ?? 0n) + credited - worth);
          difference += credited - worth;
          if (!members.includes(head.member)) members.push(head.member);
        }
        if (members.length > 0) byConversion.set(`${event.transactionHash}:${event.logIndex}`, { difference, members });
        break;
      }
    }
  }
  return { byMember, byConversion };
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
  /** Each payment the group approved, with its proposal's note, and whether it gave a contribution back (spec, 7.3). */
  payments: { member: Address; amount: bigint; note: string; givenBack: boolean }[];
  /** Who joined in the week (MemberAdded). */
  joined: Address[];
};

/**
 * The photo of the week `fund` was read in, at its last block (spec, 9.4). `events` go from the fund's creation up to
 * that block: the dues need every MemberAdded (joinWeeks, with the screen's `weekOf`), and a payment's note is in its
 * proposal, which may be older than the week. Only the events from `first` on are the week's. Conversions only count
 * in the dues, through what they got under or over what their USDT was credited (conversionLoss): the summary doesn't
 * list them. `giveBacks` are the proposals (by id) that gave a contribution back.
 */
export function weekSummary({
  fund,
  balance,
  weeklyFee,
  events,
  first,
  weekOf,
  giveBacks = new Set(),
}: {
  fund: FundSnapshot;
  balance: bigint;
  weeklyFee: bigint;
  events: readonly FundEvent[];
  first: bigint;
  weekOf: (event: FundEvent) => bigint;
  giveBacks?: ReadonlySet<bigint>;
}): WeekSummaryFacts {
  const dues = memberDues({
    fund,
    weeklyFee,
    joined: joinWeeks(events, weekOf),
    givenBack: givenBack(events, giveBacks),
    conversionLoss: conversionLoss(events).byMember,
  }).map(({ member, owed }) => ({
    member,
    owed,
  }));
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
        const id = paidProposal(week, event);
        payments.push({
          member: getAddress(event.args.member),
          amount: event.args.amount,
          note: id === undefined ? "" : (notes.get(id) ?? ""),
          givenBack: id !== undefined && giveBacks.has(id),
        });
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
