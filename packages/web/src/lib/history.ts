import { type FundEvent, type FundSnapshot, RPC_LOG_RANGE } from "@tesoreria/agent";
import { type Address, getAddress } from "viem";

/** The history read doesn't add up: some event is missing, so nothing is shown from it. */
export class HistoryGapError extends Error {
  override name = "HistoryGapError";
}

/**
 * Where a history doesn't add up to the contract read at its last block, or null if it does:
 * - only reimbursements add to spentInWeek (Fund.sol), so this week's Reimbursement events must sum to it;
 * - each member's Contribution events must sum to what the contract says they contributed, following a replaced
 *   member's to who took their place (Fund.sol moves it) and leaving out one who left (it's zeroed);
 * - there must be one ProposalCreated per proposal.
 * Blockscout once answered a day behind for logs by address while its block number was current (3/11): only the
 * contract's own counts tell a whole history from one with a hole.
 */
function historyGap(snapshot: FundSnapshot, events: readonly FundEvent[]): string | null {
  let reimbursed = 0n;
  let proposals = 0n;
  const contributed = new Map<Address, bigint>();
  for (const e of events) {
    switch (e.eventName) {
      case "Reimbursement":
        if (e.args.week === snapshot.week) reimbursed += e.args.amount;
        break;
      case "ProposalCreated":
        proposals++;
        break;
      case "Contribution": {
        const member = getAddress(e.args.member);
        contributed.set(member, (contributed.get(member) ?? 0n) + e.args.creditedWars);
        break;
      }
      case "MemberReplaced":
        contributed.set(getAddress(e.args.newMember), contributed.get(getAddress(e.args.oldMember)) ?? 0n);
        contributed.delete(getAddress(e.args.oldMember));
        break;
      case "MemberRemoved":
        contributed.delete(getAddress(e.args.member));
        break;
    }
  }
  if (reimbursed !== snapshot.spentThisWeek) {
    return `This week's reimbursements add up to ${reimbursed}, but spentInWeek is ${snapshot.spentThisWeek}`;
  }
  for (const [i, member] of snapshot.members.entries()) {
    const read = contributed.get(getAddress(member)) ?? 0n;
    const onChain = snapshot.contributed[i] ?? 0n;
    if (read !== onChain) return `Member ${i + 1}'s contributions add up to ${read}, but the contract says ${onChain}`;
  }
  if (proposals !== snapshot.proposalCount) {
    return `The history has ${proposals} proposals, but the contract has ${snapshot.proposalCount}`;
  }
  return null;
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
