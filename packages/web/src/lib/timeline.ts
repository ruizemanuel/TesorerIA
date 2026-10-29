import { type FundEvent, type SkipCode, USDT } from "@tesoreria/agent";
import { type Address, type Hash, getAddress, isAddressEqual } from "viem";
import { type BlockClock, blockTime, weekAt } from "./chain-time";
import type { ExpenseStatus } from "./db/schema";
import { ProposalAction } from "./fund-abi";
import { formatPesos, formatUsdt } from "./format";
import type { Messages } from "./i18n/messages";
import { sameName } from "./same-name";

export type Actor = { kind: "agent" } | { kind: "member"; name: string } | { kind: "group" };

export type TimelineAction =
  | { kind: "receipt"; tx: Hash }
  | { kind: "vote"; proposalId: bigint; votes: number; required: number; canVote: boolean; voted: boolean; completes: boolean }
  | { kind: "execute"; proposalId: bigint; canExecute: boolean }
  /**
   * Proponer sumarlo, for someone who asked to join (spec, 9.4). `headsUp` goes with the button, only when it is offered:
   * the requester's name is another person's here, so a member should check with the group before proposing.
   */
  | { kind: "propose-member"; account: Address; canPropose: boolean; headsUp?: string }
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
  kind: "create-fund" | "contribute" | "vote" | "execute" | "cash-out" | "propose" | "key-change";
  amount: bigint | null;
  token: "wars" | "usdt" | null;
  createdAt: Date;
};

/** The agent's latest word on the USDT the fund still holds: it skipped converting it, or couldn't (F8). */
export type ConversionHold = { usdt: bigint; code: string | null; at: Date };

/**
 * Someone who asked to join the live fund (join-requests.ts, spec 9.4): their account and name, and whether the request is
 * still open, as the database says. `at` is when they asked, or when it expired.
 */
export type TimelineJoinRequest = { account: Address; name: string; at: Date; open: boolean };

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
  joinRequests = [],
  memberNames = [],
  canAddMembers = false,
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
  /** Who asked to join (members' screens only), and whether the fund has room for one more on the chain. */
  joinRequests?: readonly TimelineJoinRequest[];
  /** The names of the fund's current members, as the database has them: an open request with one of them gets a heads-up. */
  memberNames?: readonly string[];
  canAddMembers?: boolean;
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
  const proposeOnItsWay = pending.some((operation) => operation.kind === "propose");
  /** The accounts an open AddMember proposal would add: their request is told by the proposal now. */
  const beingProposed = new Set<Address>();
  const newcomer = (address: Address) => names.get(getAddress(address)) ?? t.newAccount;
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
        const what = proposalText(m, action, a, amount, note, who, newcomer, agreedExpense);
        const byAgent = isAddressEqual(proposer, agent);
        const state = proposals.get(id);
        if (action === ProposalAction.AddMember && state !== undefined && !state.executed && state.deadline > nowSeconds) beingProposed.add(getAddress(a));
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

  // Who asked to join, for the group to propose (spec, 9.4): never on the public view, which has no requests.
  const asking = viewerIsMember ? joinRequests : [];
  const open = asking.filter((request) => request.open);
  // Names can't be refused, so a member who might propose the wrong account is told: the name is a member's, or another open request's.
  const sharesName = (request: TimelineJoinRequest) =>
    memberNames.some((member) => sameName(member, request.name)) ||
    open.some((other) => !isAddressEqual(other.account, request.account) && sameName(other.name, request.name));
  for (const request of asking) {
    if (beingProposed.has(getAddress(request.account))) continue;
    const base = { id: `join:${request.account}`, at: request.at, actor: { kind: "member", name: request.name } as Actor };
    const canPropose = canAddMembers && !proposeOnItsWay;
    items.push(
      request.open
        ? {
            ...base,
            text: t.joinRequest(request.name),
            // The line is for the member who is about to propose: it shows exactly when the button does.
            action: {
              kind: "propose-member",
              account: request.account,
              canPropose,
              ...(canPropose && sharesName(request) ? { headsUp: t.joinRequestSameName(request.name) } : {}),
            },
          }
        : { ...base, text: t.joinRequestExpired(request.name) },
    );
  }

  for (const operation of pending) {
    // A createFund isn't the fund's yet, a pass to pesos moves the member's own account (spec, 9.2), and a key change
    // swaps that account's passkey (9.5).
    if (operation.kind === "create-fund" || operation.kind === "cash-out" || operation.kind === "key-change") continue;
    const text =
      operation.kind === "vote"
        ? t.onItsWay.vote
        : operation.kind === "execute"
          ? t.onItsWay.execute
          : operation.kind === "propose"
            ? t.onItsWay.propose
            : t.onItsWay.contribution(
                operation.token === "usdt" ? formatUsdt(operation.amount ?? 0n, m.locale) : formatPesos(operation.amount ?? 0n, m.locale),
              );
    items.push({ id: `op:${operation.userOpHash}`, at: operation.createdAt, actor: { kind: "member", name: t.you }, text, pending: true });
  }

  return items.sort((x, y) => y.at.getTime() - x.at.getTime());
}

/** A proposal that waits for the viewer: one they can vote, or one with its votes that they can carry out. */
function waitsForViewer({ action }: TimelineItem): boolean {
  return (action?.kind === "vote" && action.canVote) || (action?.kind === "execute" && action.canExecute);
}

/**
 * Te toca (spec, 9.8): what waits for the viewer, oldest first, since a proposal expires 7 days after it's made; and
 * the rest of `items` (newest first, as buildTimeline gives them), for the inicio's latest without repeating it. A
 * closed fund has nothing: its proposals can no longer be voted or carried out.
 */
export function splitYourTurn(
  items: readonly TimelineItem[],
  { closed = false }: { closed?: boolean } = {},
): { yourTurn: TimelineItem[]; rest: TimelineItem[] } {
  if (closed) return { yourTurn: [], rest: [...items] };
  return {
    yourTurn: items.filter(waitsForViewer).reverse(),
    rest: items.filter((item) => !waitsForViewer(item)),
  };
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
  /** The name of someone being added: who asked to join, or "una cuenta nueva" without one. */
  newcomer: (address: Address) => string,
  agreedExpense: string,
): string {
  const t = m.timeline.proposal;
  switch (action) {
    case ProposalAction.Pay:
      return t.pay(formatPesos(amount, m.locale), who(a), note);
    case ProposalAction.AddMember:
      return t.addMember(newcomer(a));
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
