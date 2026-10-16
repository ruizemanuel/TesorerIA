import { type FundEvent, type SkipCode, USDT } from "@tesoreria/agent";
import { type Address, type Hash, getAddress, isAddressEqual } from "viem";
import { type BlockClock, blockTime, weekAt } from "./chain-time";
import type { ExpenseStatus } from "./db/schema";
import { ProposalAction } from "./fund-abi";
import { formatPesos, formatUsdt } from "./format";
import type { Messages } from "./i18n/messages";

export type Actor = { kind: "agent" } | { kind: "member"; name: string } | { kind: "group" };

export type TimelineAction =
  | { kind: "receipt"; tx: Hash }
  | { kind: "vote"; proposalId: bigint; votes: number; required: number; canVote: boolean; voted: boolean; completes: boolean }
  | { kind: "execute"; proposalId: bigint; canExecute: boolean }
  /** A week's summary (spec, 9.4), by the contract's week: "Ver el resumen". */
  | { kind: "summary"; week: number };

export type TimelineItem = {
  id: string;
  at: Date;
  actor: Actor;
  text: string;
  /** For the comprobante: why, in the rules' words (spec, 9.2). */
  detail?: string;
  /** At most one per item (spec, 9.2). */
  action?: TimelineAction;
  /** Still on its way. */
  pending?: boolean;
};

/** An open or finished proposal, as the chain has it now. */
export type ProposalState = { votes: number; executed: boolean; deadline: bigint; voted: boolean };

export type TimelineExpense = { id: string; by: string; amount: bigint; note: string; status: ExpenseStatus; createdAt: Date };

export type TimelinePending = {
  userOpHash: string;
  kind: "create-fund" | "contribute" | "vote" | "execute" | "cash-out";
  amount: bigint | null;
  token: "wars" | "usdt" | null;
  createdAt: Date;
};

/** The agent's latest word on the USDT the fund still holds: it skipped converting it, or couldn't (F8). */
export type ConversionHold = { usdt: bigint; code: string | null; at: Date };

/** Why the agent hasn't converted, as it says it (spec, 9.2: no jargon): by its skip code, or the dictionary's `other`. */
function holdWhy(m: Messages, code: string | null): string {
  const why = m.timeline.holdWhy;
  return code !== null && Object.hasOwn(why, code) ? why[code as SkipCode] : why.other;
}

/**
 * The fund's movements, newest first (spec, 9.2): its events, the expenses the agent still holds, and the
 * viewer's own operations on their way. The agent speaks in first person; a member's actions are in third;
 * what the group decided is the fund's. Every sentence is the dictionary's (`m`), in the page's language (spec, 9.3).
 */
export function buildTimeline({
  events,
  clock,
  agent,
  names,
  agreedExpense,
  initialWeeklyCap,
  startTime,
  votesRequired,
  memberCount,
  proposals,
  expenses,
  pending,
  conversionHold = null,
  summaries = [],
  warsBalance,
  viewerIsMember,
  now,
  m,
}: {
  /** In chain order, oldest first, as readFundEvents gives them: the weekly cap in force is tracked along the way. */
  events: readonly FundEvent[];
  clock: BlockClock;
  agent: Address;
  /** First names by checksummed account. */
  names: ReadonlyMap<Address, string>;
  agreedExpense: string;
  /** The cap the fund was created with (in the database); WeeklyCapChanged events update it. */
  initialWeeklyCap: bigint;
  startTime: bigint;
  votesRequired: number;
  memberCount: number;
  /** By proposal id, for every ProposalCreated in `events`. */
  proposals: ReadonlyMap<bigint, ProposalState>;
  expenses: readonly TimelineExpense[];
  pending: readonly TimelinePending[];
  /** Why the USDT waiting hasn't been converted yet, or null (read-fund.ts, conversionHold). */
  conversionHold?: ConversionHold | null;
  /** The agent's summary of each week that closed (spec, 9.4): the contract's week, and when the agent wrote it. */
  summaries?: readonly { week: number; at: Date }[];
  /** The wARS the fund holds now: a payment over it can't be executed yet. */
  warsBalance: bigint;
  viewerIsMember: boolean;
  now: Date;
  /** The page's dictionary: its sentences, and `m.locale` for the amounts. */
  m: Messages;
}): TimelineItem[] {
  const t = m.timeline;
  const items: TimelineItem[] = [];
  const who = (address: Address) => names.get(getAddress(address)) ?? t.someone;
  const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
  const currentWeek = weekAt(now, startTime);
  const spent = new Map<bigint, bigint>();
  const voteOnItsWay = pending.some((operation) => operation.kind === "vote");
  const executeOnItsWay = pending.some((operation) => operation.kind === "execute");
  let cap = initialWeeklyCap;

  for (const event of events) {
    const base = {
      id: `${event.transactionHash}:${event.logIndex}`,
      at: blockTime(event.blockNumber, clock),
      action: { kind: "receipt", tx: event.transactionHash } as TimelineAction,
    };
    switch (event.eventName) {
      case "Contribution": {
        const { member, token, amount } = event.args;
        const what = isAddressEqual(token, USDT) ? formatUsdt(amount, m.locale) : formatPesos(amount, m.locale);
        items.push({ ...base, actor: { kind: "member", name: who(member) }, text: t.contributed(who(member), what) });
        break;
      }
      case "Conversion": {
        const { usdtIn, warsOut } = event.args;
        items.push({
          ...base,
          actor: { kind: "agent" },
          text: t.converted(formatUsdt(usdtIn, m.locale), formatPesos(warsOut, m.locale)),
          detail: t.convertedDetail,
        });
        break;
      }
      case "Reimbursement": {
        const { member, amount, week } = event.args;
        const total = (spent.get(week) ?? 0n) + amount;
        spent.set(week, total);
        const left = formatPesos(cap > total ? cap - total : 0n, m.locale);
        const tail = week === currentWeek ? t.reimbursedLeftThisWeek(left) : t.reimbursedLeftThatWeek(left);
        items.push({
          ...base,
          actor: { kind: "agent" },
          text: `${t.reimbursed(formatPesos(amount, m.locale), who(member), agreedExpense)} ${tail}`,
          detail: t.reimbursedDetail(agreedExpense, formatPesos(cap, m.locale)),
        });
        break;
      }
      case "ProposalCreated": {
        const { id, action, a, amount, proposer, note } = event.args;
        const what = proposalText(m, action, a, amount, note, who, agreedExpense);
        const byAgent = isAddressEqual(proposer, agent);
        const state = proposals.get(id);
        let tail = "";
        let proposalAction: TimelineAction | undefined;
        if (state !== undefined) {
          const hasVotes = state.votes >= votesRequired;
          if (state.executed) tail = t.proposal.approved;
          else if (state.deadline <= nowSeconds) tail = hasVotes ? t.proposal.expiredWithVotes : t.proposal.expiredWithoutVotes;
          else if (hasVotes) {
            // The vote that completed the count couldn't execute it then (castVote): the fund may still be short.
            const short = action === ProposalAction.Pay && amount > warsBalance ? amount - warsBalance : 0n;
            if (short > 0n) tail = t.proposal.short(formatPesos(short, m.locale));
            else {
              tail = t.proposal.needsCarryingOut;
              proposalAction = { kind: "execute", proposalId: id, canExecute: viewerIsMember && !executeOnItsWay };
            }
          } else {
            tail = t.proposal.votes(state.votes, votesRequired);
            proposalAction = {
              kind: "vote",
              proposalId: id,
              votes: state.votes,
              required: votesRequired,
              // A pending operation doesn't say which proposal it votes, so any vote of the viewer's on its way holds them all.
              canVote: viewerIsMember && !state.voted && !voteOnItsWay,
              voted: state.voted,
              completes: state.votes + 1 >= votesRequired,
            };
          }
        }
        items.push({
          id: base.id,
          at: base.at,
          actor: byAgent ? { kind: "agent" } : { kind: "member", name: who(proposer) },
          text: joined(byAgent ? t.proposal.byAgent(what) : t.proposal.byMember(who(proposer), what), tail),
          detail: byAgent ? t.proposal.agentDetail(votesRequired) : undefined,
          action: proposalAction,
        });
        break;
      }
      case "Payment": {
        const { member, amount } = event.args;
        items.push({ ...base, actor: { kind: "group" }, text: t.paid(formatPesos(amount, m.locale), who(member)) });
        break;
      }
      case "MemberAdded": {
        const name = names.get(getAddress(event.args.member)) ?? t.newAccount;
        items.push({ ...base, actor: { kind: "group" }, text: t.memberAdded(name) });
        break;
      }
      case "MemberRemoved":
        items.push({ ...base, actor: { kind: "group" }, text: t.memberRemoved(who(event.args.member)) });
        break;
      case "MemberReplaced":
        items.push({ ...base, actor: { kind: "group" }, text: t.memberReplaced(who(event.args.newMember)) });
        break;
      case "WeeklyCapChanged":
        cap = event.args.cap;
        items.push({ ...base, actor: { kind: "group" }, text: t.weeklyCapChanged(agreedExpense, formatPesos(cap, m.locale)) });
        break;
      case "VotesRequiredChanged":
        items.push({ ...base, actor: { kind: "group" }, text: t.votesRequiredChanged(event.args.votes, agreedExpense) });
        break;
      case "AgentChanged":
        items.push({ ...base, actor: { kind: "group" }, text: t.agentChanged });
        break;
      case "FundClosed":
        items.push({ ...base, actor: { kind: "group" }, text: t.fundClosed });
        break;
      case "RemainderDistributed": {
        // Rounding dust after closing, which anyone can "distribute" over and over (spec, 7.3).
        const dust = BigInt(memberCount);
        if (event.args.warsBalance < dust && event.args.usdtBalance < dust) break;
        items.push({ ...base, actor: { kind: "group" }, text: t.remainderDistributed });
        break;
      }
      // VoteCast and ProposalExecuted are folded into their proposal.
    }
  }

  if (conversionHold !== null) {
    items.push({
      id: "conversion-hold",
      at: conversionHold.at,
      actor: { kind: "agent" },
      text: t.hold(formatUsdt(conversionHold.usdt, m.locale), holdWhy(m, conversionHold.code)),
    });
  }

  for (const summary of summaries) {
    items.push({
      id: `summary:${summary.week}`,
      at: summary.at,
      actor: { kind: "agent" },
      text: t.weekClosed(summary.week + 1),
      action: { kind: "summary", week: summary.week },
    });
  }

  for (const expense of expenses) {
    const what = t.expense.what(formatPesos(expense.amount, m.locale), expense.by, expense.note);
    const text: Partial<Record<ExpenseStatus, string>> = {
      new: t.expense.looking(what),
      sending: t.expense.looking(what),
      waiting: t.expense.waiting(what),
      blocked: t.expense.blocked(what),
      rejected: t.expense.rejected(what),
    };
    const sentence = text[expense.status];
    if (sentence === undefined) continue; // reimbursed or proposed: the chain tells it
    const pendingNow = expense.status === "new" || expense.status === "sending";
    items.push({ id: `expense:${expense.id}`, at: expense.createdAt, actor: { kind: "agent" }, text: sentence, pending: pendingNow || undefined });
  }

  for (const operation of pending) {
    // A createFund isn't the fund's yet, and a pass to pesos moves the member's own account (spec, 9.2).
    if (operation.kind === "create-fund" || operation.kind === "cash-out") continue;
    const text =
      operation.kind === "vote"
        ? t.onItsWay.vote
        : operation.kind === "execute"
          ? t.onItsWay.execute
          : t.onItsWay.contribution(
              operation.token === "usdt" ? formatUsdt(operation.amount ?? 0n, m.locale) : formatPesos(operation.amount ?? 0n, m.locale),
            );
    items.push({ id: `op:${operation.userOpHash}`, at: operation.createdAt, actor: { kind: "member", name: t.you }, text, pending: true });
  }

  return items.sort((x, y) => y.at.getTime() - x.at.getTime());
}

/** A sentence and, when there is one, the one that goes after it. */
function joined(sentence: string, after: string): string {
  return after === "" ? sentence : `${sentence} ${after}`;
}

function proposalText(
  m: Messages,
  action: number,
  a: Address,
  amount: bigint,
  note: string,
  who: (address: Address) => string,
  agreedExpense: string,
): string {
  const t = m.timeline.proposal;
  switch (action) {
    case ProposalAction.Pay:
      return t.pay(formatPesos(amount, m.locale), who(a), note);
    case ProposalAction.AddMember:
      return t.addMember;
    case ProposalAction.RemoveMember:
      return t.removeMember(who(a));
    case ProposalAction.ReplaceMember:
      return t.replaceMember(who(a));
    case ProposalAction.SetWeeklyCap:
      return t.setWeeklyCap(agreedExpense, formatPesos(amount, m.locale));
    case ProposalAction.SetVotesRequired:
      return t.setVotesRequired(Number(amount), agreedExpense);
    case ProposalAction.SetAgent:
      return t.setAgent;
    default:
      return t.close;
  }
}
