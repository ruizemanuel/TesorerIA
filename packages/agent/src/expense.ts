import { type Address, type Hash, type Hex, formatUnits, isAddressEqual } from "viem";
import { Action } from "./abi";
import type { FundEvent } from "./events";
import { type FundSnapshot, proposalQuota } from "./fund";
import { type DailyActivity, MAX_NOTE_LENGTH, fundCurrency, reimbursementLimits } from "./limits";
// Type only: run.ts imports this file.
import type { WaitCode } from "./run";

/**
 * An expense a member entered in the web app. `member` is the account that entered it, never an address
 * typed by someone or written by the model.
 */
export type Expense = {
  member: Address;
  /** In the fund's currency, in its token's units (18 decimals for every wFIAT). */
  amount: bigint;
  /**
   * "agreed" is the expense the fund pays back without a vote, up to the weekly cap. "give-back" is part of what the
   * member contributed, given back to them (spec, 7.3): always voted on, like "other".
   */
  kind: "agreed" | "other" | "give-back";
  /** The expense's id in the web app, as 32 bytes: it goes on chain with the reimbursement. */
  ref: Hex;
  note: string;
  /** When the member entered it, in unix seconds: no proposal the agent made before then is this expense's. */
  enteredAt: bigint;
};

export type ExpenseDecision =
  | { kind: "reimburse"; member: Address; amount: bigint; ref: Hex }
  | { kind: "propose-payment"; member: Address; amount: bigint; note: string; reason: string }
  /** A contribution given back, by vote: a version 2 fund only (in version 1 it is a payment). */
  | { kind: "propose-give-back"; member: Address; amount: bigint; note: string; reason: string }
  /** The agent already proposed this payment, in `transactionHash`: proposing it again would make two. */
  | { kind: "proposed"; transactionHash: Hash; reason: string }
  /** `code` says why, when the web has its own words for it. */
  | { kind: "wait"; reason: string; code?: WaitCode }
  | { kind: "reject"; reason: string };

/** Keeps a note within MAX_NOTE_LENGTH characters, for the chain. */
function clip(note: string): string {
  return [...note.trim()].slice(0, MAX_NOTE_LENGTH).join("");
}

/**
 * Less than half a centavo of the fund's currency (each one in the table has 18 decimals): what a screen in centavos
 * can't show. The fund's balance is shown rounded, so an expense of what the screen said the fund holds can be up to
 * this much more than it does.
 */
const CURRENCY_SPECK = 5n * 10n ** 15n;

/**
 * What to pay for an expense of `amount`: what the fund holds instead, when it holds something and is short by less
 * than CURRENCY_SPECK. Paying the amount as entered would fail on chain for a difference nobody can see.
 */
function payable(amount: bigint, held: bigint): bigint {
  return held > 0n && amount > held && amount - held < CURRENCY_SPECK ? held : amount;
}

/**
 * How many blocks before an expense was entered a proposal of the agent's may still be this expense's: Celo makes
 * a block a second, and this is five minutes for the server's clock and the chain's to disagree.
 */
const ENTRY_MARGIN_BLOCKS = 300n;

/**
 * The agent's own proposal of this payment, if it already made one since the expense was entered: a send that threw
 * after the node took it, retried. The contract keeps no ref for proposals (unlike reimbursements), so it's told by
 * what it pays: `action` (Pay, or GiveBack for a give-back in a version 2 fund), to the same member, the same amount,
 * with the same note, proposed by the agent, from about the block the expense was entered in (`now` and the snapshot's
 * block place it, at a block a second). An identical expense entered later is another one, and gets its own proposal.
 * So does one entered before: an expense can wait days for the agent's weekly proposals, and a proposal made in a
 * transaction the web app recorded for another of the fund's expenses (`claimed`) is that one's.
 * "The same amount" takes in what the fund held then (`payable`), up to CURRENCY_SPECK less: the fund may hold more by
 * the retry. Amounts are entered in centavos, so another expense's is at least a centavo away.
 */
function earlierProposal(
  events: readonly FundEvent[],
  {
    fund,
    action,
    member,
    amount,
    note,
    enteredAt,
    now,
    claimed,
  }: { fund: FundSnapshot; action: number; member: Address; amount: bigint; note: string; enteredAt: bigint; now: bigint; claimed: readonly Hash[] },
): FundEvent | undefined {
  const since = fund.block - (now > enteredAt ? now - enteredAt : 0n) - ENTRY_MARGIN_BLOCKS;
  const taken = new Set(claimed.map((hash) => hash.toLowerCase()));
  return events.find(
    (e) =>
      e.eventName === "ProposalCreated" &&
      !taken.has(e.transactionHash.toLowerCase()) &&
      e.blockNumber >= since &&
      e.args.action === action &&
      isAddressEqual(e.args.proposer, fund.agent) &&
      isAddressEqual(e.args.a, member) &&
      e.args.amount <= amount &&
      amount - e.args.amount < CURRENCY_SPECK &&
      e.args.note === note,
  );
}

const BPS = 10_000n;

/**
 * What a member's give-back may be, in a version 2 fund, when it's above what they contributed: nothing to decide
 * (null) if it isn't; `wait` if their pending dollars cover it once converted (what the conversion credits is
 * `pendingValue` less the fee, as in the contract); otherwise `reject`, saying how much they can ask for.
 */
function giveBackAboveContributed(fund: FundSnapshot, member: Address, amount: bigint): ExpenseDecision | null {
  const i = fund.members.indexOf(member);
  const contributed = fund.contributed[i] ?? 0n;
  if (amount <= contributed) return null;
  const pendingValue = fund.pendingValue[i] ?? 0n;
  const coming = pendingValue - (pendingValue * BigInt(fund.feeBps)) / BPS;
  if (amount <= contributed + coming) {
    return { kind: "wait", reason: "The member's pending dollars have to be converted first: it's above what they have contributed so far" };
  }
  const { symbol, decimals } = fundCurrency(fund);
  // Rounded down to the centavo: the figure is never more than there is.
  const most = formatUnits((contributed + coming) / 10n ** BigInt(decimals - 2), 2);
  return { kind: "reject", reason: `Above what the member contributed and has pending: they can ask for at most ${most} ${symbol}` };
}

/**
 * What to do with an expense (spec, 8.1): pay the agreed expense back if it fits in what's left of the week's
 * cap and the agent's limits; anything else becomes a payment proposal for the members to vote on, unless the
 * agent already proposed it. In a version 2 fund a give-back is a `GiveBack` proposal, and a proposal waits for next
 * week when the member has no part left of the agent's weekly proposals (`proposalQuota`).
 */
export function decideExpense({
  expense,
  fund,
  events,
  today,
  now,
  claimed = [],
}: {
  expense: Expense;
  fund: FundSnapshot;
  /** The fund's whole history: the contract doesn't stop a second reimbursement with the same `ref`. */
  events: readonly FundEvent[];
  today: DailyActivity;
  /** Unix seconds. */
  now: bigint;
  /** The transactions the web app recorded for the fund's other expenses: a proposal made in one of them is never this expense's. */
  claimed?: readonly Hash[];
}): ExpenseDecision {
  if (fund.closed) return { kind: "reject", reason: "The fund is closed" };
  const member = fund.members.find((m) => isAddressEqual(m, expense.member));
  if (member === undefined) return { kind: "reject", reason: "Only members get money back" };
  const { ref } = expense;
  if (expense.amount <= 0n) return { kind: "reject", reason: "The amount must be more than zero" };
  const amount = payable(expense.amount, fund.currencyBalance);
  const earlier = events.find(
    (e) => e.eventName === "Reimbursement" && e.args.ref.toLowerCase() === ref.toLowerCase(),
  );
  if (earlier !== undefined) {
    return { kind: "reject", reason: `Already reimbursed, in transaction ${earlier.transactionHash}` };
  }

  const giveBack = fund.version === 2 && expense.kind === "give-back";
  // In order: a proposal that already went out is this expense's, whatever the quota says now (it may have taken the
  // last place); then what a give-back may ask for; then the quota.
  const propose = (reason: string): ExpenseDecision => {
    const note = clip(expense.note);
    const action = giveBack ? Action.GiveBack : Action.Pay;
    const proposed = earlierProposal(events, { fund, action, member, amount: expense.amount, note, enteredAt: expense.enteredAt, now, claimed });
    if (proposed !== undefined) {
      const { transactionHash } = proposed;
      return { kind: "proposed", transactionHash, reason: `Already proposed, in transaction ${transactionHash}` };
    }
    if (giveBack) {
      const over = giveBackAboveContributed(fund, member, amount);
      if (over !== null) return over;
    }
    if (proposalQuota(fund, events, member)?.left === 0) {
      return {
        kind: "wait",
        code: "proposal-quota",
        reason: "The agent's proposals for this week are shared among the members and none is left for this one: it will be proposed when next week starts",
      };
    }
    return giveBack ? { kind: "propose-give-back", member, amount, note, reason } : { kind: "propose-payment", member, amount, note, reason };
  };
  if (expense.kind === "give-back") return propose("A contribution given back is always voted on");
  if (expense.kind === "other") return propose("Only the agreed expense is paid back without a vote");
  const { symbol, decimals } = fundCurrency(fund);
  const left = fund.weeklyCap > fund.spentThisWeek ? fund.weeklyCap - fund.spentThisWeek : 0n;
  if (amount > left) {
    return propose(`It doesn't fit in what's left of this week's cap (${formatUnits(left, decimals)} ${symbol})`);
  }
  const { perReimbursement, perDay } = reimbursementLimits(fund);
  if (amount > perReimbursement) return propose("It's above the agent's per-reimbursement limit");
  if (today.reimbursed + amount > perDay) return propose("It's above the agent's daily reimbursement limit");
  if (amount > fund.currencyBalance) return { kind: "wait", reason: `The fund doesn't hold enough ${symbol} yet` };
  return { kind: "reimburse", member, amount, ref };
}
