import { type FundEvent, type FundSnapshot, RPC_LOG_RANGE, USDT } from "@tesoreria/agent";
import { type Address, getAddress, isAddressEqual } from "viem";

/** The history read doesn't add up: some event is missing, so nothing is shown from it. */
export class HistoryGapError extends Error {
  override name = "HistoryGapError";
}

/**
 * Where a history doesn't add up to the contract read at its last block, or null if it does. In both versions:
 * - only reimbursements add to spentInWeek, so this week's Reimbursement events must sum to it;
 * - each member's own counts must sum to what the contract says, following a replaced member's to who took their
 *   place (the contract moves them) and leaving out one who left (it zeroes them): version1Gap and version2Gap;
 * - there must be one ProposalCreated per proposal.
 * Blockscout once answered a day behind for logs by address while its block number was current (3/11): only the
 * contract's own counts tell a whole history from one with a hole.
 */
function historyGap(snapshot: FundSnapshot, events: readonly FundEvent[]): string | null {
  return snapshot.version === 2 ? version2Gap(snapshot, events) : version1Gap(snapshot, events);
}

/**
 * Version 1 (Fund.sol):
 * - the USDT contributed, less what conversions, members who left and closing took out, can't be more than the fund
 *   holds: a missing Conversion would make what converting each member's USDT lost come out wrong (conversion-loss
 *   design). USDT sent straight to the fund only adds to what it holds, so it's a bound, not an equality;
 * - each member's Contribution events must sum to what the contract says they contributed.
 */
function version1Gap(snapshot: FundSnapshot, events: readonly FundEvent[]): string | null {
  let usdtLeft = 0n;
  const contributed = new Map<Address, bigint>();
  for (const e of events) {
    switch (e.eventName) {
      case "Contribution": {
        const member = getAddress(e.args.member);
        contributed.set(member, (contributed.get(member) ?? 0n) + e.args.credited);
        if (isAddressEqual(e.args.token, USDT)) usdtLeft += e.args.amount;
        break;
      }
      case "Conversion":
        usdtLeft -= e.args.dollarIn;
        break;
      case "FundClosed":
      case "RemainderDistributed":
        usdtLeft -= e.args.dollarBalance;
        break;
      case "MemberReplaced":
        contributed.set(getAddress(e.args.newMember), contributed.get(getAddress(e.args.oldMember)) ?? 0n);
        contributed.delete(getAddress(e.args.oldMember));
        break;
      case "MemberRemoved":
        contributed.delete(getAddress(e.args.member));
        usdtLeft -= e.args.dollarReturned;
        break;
    }
  }
  if (usdtLeft > snapshot.dollarBalance) {
    return `USDT contributed less what left adds up to ${usdtLeft}, more than the fund holds (${snapshot.dollarBalance})`;
  }
  return reimbursementGap(snapshot, events) ?? memberGap(snapshot, "contributions", contributed, snapshot.contributed) ?? proposalGap(snapshot, events);
}

/**
 * Version 2 (FundV2.sol), by member:
 * - what the currency's Contribution events credited, plus what each Conversion credited, less what each
 *   ContributionGivenBack paid back, must be what the contract says they contributed;
 * - their dollar contributions, less what each Conversion took of them, must be their pending dollars. The close gives
 *   everyone's back with no event per member, so after FundClosed nobody has any;
 * and the members' pending dollars can't be more than the dollar the fund holds: the rest is dollar sent straight to
 * it, which is nobody's.
 */
function version2Gap(snapshot: FundSnapshot, events: readonly FundEvent[]): string | null {
  const contributed = new Map<Address, bigint>();
  const pending = new Map<Address, bigint>();
  const add = (counts: Map<Address, bigint>, member: Address, amount: bigint) => {
    const account = getAddress(member);
    counts.set(account, (counts.get(account) ?? 0n) + amount);
  };
  for (const e of events) {
    switch (e.eventName) {
      case "Contribution":
        // A dollar contribution is credited with nothing until it's converted.
        add(contributed, e.args.member, e.args.credited);
        if (snapshot.dollar !== null && isAddressEqual(e.args.token, snapshot.dollar)) add(pending, e.args.member, e.args.amount);
        break;
      case "Conversion":
        // Only FundV2's names its member.
        if (!("member" in e.args)) break;
        add(contributed, e.args.member, e.args.credited);
        add(pending, e.args.member, -e.args.dollarIn);
        break;
      case "ContributionGivenBack":
        add(contributed, e.args.member, -e.args.amount);
        break;
      case "MemberReplaced":
        for (const counts of [contributed, pending]) {
          counts.set(getAddress(e.args.newMember), counts.get(getAddress(e.args.oldMember)) ?? 0n);
          counts.delete(getAddress(e.args.oldMember));
        }
        break;
      case "MemberRemoved":
        contributed.delete(getAddress(e.args.member));
        pending.delete(getAddress(e.args.member));
        break;
      case "FundClosed":
        pending.clear();
        break;
    }
  }
  const gap = memberGap(snapshot, "contributions", contributed, snapshot.contributed) ?? memberGap(snapshot, "pending dollars", pending, snapshot.pendingDollar);
  if (gap !== null) return gap;
  if (snapshot.totalPendingDollar > snapshot.dollarBalance) {
    return `The members have ${snapshot.totalPendingDollar} dollars pending, more than the fund holds (${snapshot.dollarBalance})`;
  }
  return reimbursementGap(snapshot, events) ?? proposalGap(snapshot, events);
}

/** Where a member's count read from the history isn't the contract's (`onChain`, in the order of the members), or null. */
function memberGap(snapshot: FundSnapshot, what: string, read: ReadonlyMap<Address, bigint>, onChain: readonly bigint[]): string | null {
  for (const [i, member] of snapshot.members.entries()) {
    const fromHistory = read.get(getAddress(member)) ?? 0n;
    const contract = onChain[i] ?? 0n;
    if (fromHistory !== contract) return `Member ${i + 1}'s ${what} add up to ${fromHistory}, but the contract says ${contract}`;
  }
  return null;
}

/** Whether this week's Reimbursement events add up to the contract's spentInWeek. */
function reimbursementGap(snapshot: FundSnapshot, events: readonly FundEvent[]): string | null {
  let reimbursed = 0n;
  for (const e of events) if (e.eventName === "Reimbursement" && e.args.week === snapshot.week) reimbursed += e.args.amount;
  return reimbursed === snapshot.spentThisWeek ? null : `This week's reimbursements add up to ${reimbursed}, but spentInWeek is ${snapshot.spentThisWeek}`;
}

/** Whether the history has one ProposalCreated per proposal the contract has. */
function proposalGap(snapshot: FundSnapshot, events: readonly FundEvent[]): string | null {
  const proposals = BigInt(events.filter((e) => e.eventName === "ProposalCreated").length);
  return proposals === snapshot.proposalCount ? null : `The history has ${proposals} proposals, but the contract has ${snapshot.proposalCount}`;
}

/** Throws HistoryGapError when `events` don't add up to `snapshot`, read at their last block (historyGap). */
export function checkHistory(snapshot: FundSnapshot, events: readonly FundEvent[]): void {
  const gap = historyGap(snapshot, events);
  if (gap !== null) throw new HistoryGapError(gap);
}

/** A fund's decoded events between two blocks, both included, read from the node. */
export type NodeHistory = (fromBlock: bigint, toBlock: bigint) => Promise<FundEvent[]>;

/** The node's requests made at once when filling a hole: 100,000 blocks, about a day of Celo's. */
const NODE_REQUESTS_AT_ONCE = 20n;

/**
 * `events`, read up to `snapshot`'s block, as they came if they add up (historyGap). If they don't, the node fills
 * the hole: it reads back from the snapshot's block, RPC_LOG_RANGE blocks per request and NODE_REQUESTS_AT_ONCE
 * requests at a time, until the history adds up, and down to `fromBlock` at most. An index that fell behind misses
 * the latest blocks, so this reads about as far back as it fell. A history that doesn't add up even then throws.
 */
export async function completeHistory({
  snapshot,
  events,
  fromBlock,
  node,
}: {
  snapshot: FundSnapshot;
  events: readonly FundEvent[];
  /** No event of the fund is older than this block. */
  fromBlock: bigint;
  node: NodeHistory;
}): Promise<FundEvent[]> {
  const first = historyGap(snapshot, events);
  if (first === null) return [...events];
  const byPosition = new Map(events.map((e) => [`${e.transactionHash}:${e.logIndex}`, e]));
  let gap = first;
  for (let to = snapshot.block; to >= fromBlock; ) {
    const ranges: [bigint, bigint][] = [];
    for (let end = to; end >= fromBlock && BigInt(ranges.length) < NODE_REQUESTS_AT_ONCE; end -= RPC_LOG_RANGE) {
      ranges.push([end - RPC_LOG_RANGE + 1n > fromBlock ? end - RPC_LOG_RANGE + 1n : fromBlock, end]);
    }
    for (const e of (await Promise.all(ranges.map(([from, end]) => node(from, end)))).flat()) {
      byPosition.set(`${e.transactionHash}:${e.logIndex}`, e);
    }
    const read = ranges.at(-1)![0];
    const merged = [...byPosition.values()].sort((a, b) =>
      a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
    );
    const left = historyGap(snapshot, merged);
    if (left === null) {
      console.warn(`The history of ${snapshot.address} had a hole (${first}): blocks ${read} to ${snapshot.block} came from the node`);
      return merged;
    }
    gap = left;
    to = read - 1n;
  }
  throw new HistoryGapError(`${gap}, even with the node's blocks down to ${fromBlock}`);
}
