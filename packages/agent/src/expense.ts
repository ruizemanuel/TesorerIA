import { type Address, type Hex, formatUnits, isAddressEqual } from "viem";
import type { FundEvent } from "./events";
import type { FundSnapshot } from "./fund";
import { type DailyActivity, LIMITS, MAX_NOTE_LENGTH } from "./limits";

/**
 * An expense a member entered in the web app. `member` is the account that entered it, never an address
 * typed by someone or written by the model.
 */
export type Expense = {
  member: Address;
  /** In wARS (18 decimals). */
  amount: bigint;
  /** "agreed" is the expense the fund pays back without a vote, up to the weekly cap. */
  kind: "agreed" | "other";
  /** The expense's id in the web app, as 32 bytes: it goes on chain with the reimbursement. */
  ref: Hex;
  note: string;
};

export type ExpenseDecision =
  | { kind: "reimburse"; member: Address; amount: bigint; ref: Hex }
  | { kind: "propose-payment"; member: Address; amount: bigint; note: string; reason: string }
  | { kind: "wait"; reason: string }
  | { kind: "reject"; reason: string };

/** Keeps a note within MAX_NOTE_LENGTH characters, for the chain. */
function clip(note: string): string {
  return [...note.trim()].slice(0, MAX_NOTE_LENGTH).join("");
}

/**
 * What to do with an expense (spec, 8.1): pay the agreed expense back if it fits in what's left of the week's
 * cap and the agent's limits; anything else becomes a payment proposal for the members to vote on.
 */
export function decideExpense({
  expense,
  fund,
  events,
  today,
}: {
  expense: Expense;
  fund: FundSnapshot;
  /** The fund's whole history: the contract doesn't stop a second reimbursement with the same `ref`. */
  events: readonly FundEvent[];
  today: DailyActivity;
}): ExpenseDecision {
  if (fund.closed) return { kind: "reject", reason: "The fund is closed" };
  const member = fund.members.find((m) => isAddressEqual(m, expense.member));
  if (member === undefined) return { kind: "reject", reason: "Only members get money back" };
  const { amount, ref } = expense;
  if (amount <= 0n) return { kind: "reject", reason: "The amount must be more than zero" };
  const earlier = events.find(
    (e) => e.eventName === "Reimbursement" && e.args.ref.toLowerCase() === ref.toLowerCase(),
  );
  if (earlier !== undefined) {
    return { kind: "reject", reason: `Already reimbursed, in transaction ${earlier.transactionHash}` };
  }

  const propose = (reason: string): ExpenseDecision => ({
    kind: "propose-payment",
    member,
    amount,
    note: clip(expense.note),
    reason,
  });
  if (expense.kind === "other") return propose("Only the agreed expense is paid back without a vote");
  const left = fund.weeklyCap > fund.spentThisWeek ? fund.weeklyCap - fund.spentThisWeek : 0n;
  if (amount > left) {
    return propose(`It doesn't fit in what's left of this week's cap (${formatUnits(left, 18)} wARS)`);
  }
  if (amount > LIMITS.maxReimbursementWars) return propose("It's above the agent's per-reimbursement limit");
  if (today.reimbursedWars + amount > LIMITS.maxDailyReimbursedWars) {
    return propose("It's above the agent's daily reimbursement limit");
  }
  if (amount > fund.warsBalance) return { kind: "wait", reason: "The fund doesn't hold enough wARS yet" };
  return { kind: "reimburse", member, amount, ref };
}
