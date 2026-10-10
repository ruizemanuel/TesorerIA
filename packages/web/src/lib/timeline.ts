import { type FundEvent, USDT } from "@tesoreria/agent";
import { type Address, type Hash, getAddress, isAddressEqual } from "viem";
import { type BlockClock, blockTime, weekAt } from "./chain-time";
import type { ExpenseStatus } from "./db/schema";
import { ProposalAction } from "./fund-abi";
import { formatPesos, formatUsdt } from "./format";

export type Actor = { kind: "agent" } | { kind: "member"; name: string } | { kind: "group" };

export type TimelineAction =
  | { kind: "receipt"; tx: Hash }
  | { kind: "vote"; proposalId: bigint; votes: number; required: number; canVote: boolean; voted: boolean; completes: boolean };

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
  kind: "create-fund" | "contribute" | "vote";
  amount: bigint | null;
  token: "wars" | "usdt" | null;
  createdAt: Date;
};

/**
 * The fund's movements, newest first (spec, 9.2): its events, the expenses the agent still holds, and the
 * viewer's own operations on their way. The agent speaks in first person; a member's actions are in third;
 * what the group decided is the fund's.
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
  viewerIsMember,
  now,
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
  viewerIsMember: boolean;
  now: Date;
}): TimelineItem[] {
  const items: TimelineItem[] = [];
  const who = (address: Address) => names.get(getAddress(address)) ?? "alguien";
  const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
  const currentWeek = weekAt(now, startTime);
  const spent = new Map<bigint, bigint>();
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
        const what = isAddressEqual(token, USDT) ? formatUsdt(amount) : formatPesos(amount);
        items.push({ ...base, actor: { kind: "member", name: who(member) }, text: `${who(member)} aportó ${what}.` });
        break;
      }
      case "Conversion": {
        const { usdtIn, warsOut } = event.args;
        items.push({
          ...base,
          actor: { kind: "agent" },
          text: `Pasé a pesos los ${formatUsdt(usdtIn)} que entraron: ${formatPesos(warsOut)}.`,
          // Plain words, no jargon (spec, 9): the exchange and the price feed stay out of what people read.
          detail: "Los cambié a pesos y revisé que el precio no se alejara más de 2 % del precio de referencia del dólar, como dicen mis reglas.",
        });
        break;
      }
      case "Reimbursement": {
        const { member, amount, week } = event.args;
        const total = (spent.get(week) ?? 0n) + amount;
        spent.set(week, total);
        const left = formatPesos(cap > total ? cap - total : 0n);
        const tail = week === currentWeek ? `Quedan ${left} del tope de esta semana.` : `Quedaban ${left} del tope de esa semana.`;
        items.push({
          ...base,
          actor: { kind: "agent" },
          text: `Le devolví ${formatPesos(amount)} a ${who(member)} por ${agreedExpense}. ${tail}`,
          detail: `Era ${agreedExpense}, que devuelvo sin votación hasta ${formatPesos(cap)} por semana.`,
        });
        break;
      }
      case "ProposalCreated": {
        const { id, action, a, amount, proposer, note } = event.args;
        const what = proposalText(action, a, amount, note, who, agreedExpense);
        const byAgent = isAddressEqual(proposer, agent);
        const state = proposals.get(id);
        let tail = "";
        let voteAction: TimelineAction | undefined;
        if (state !== undefined) {
          if (state.executed) tail = " Se aprobó.";
          else if (state.deadline <= nowSeconds) tail = " Venció sin los votos necesarios.";
          else {
            tail = ` Lleva ${state.votes} de ${votesRequired} votos.`;
            voteAction = {
              kind: "vote",
              proposalId: id,
              votes: state.votes,
              required: votesRequired,
              canVote: viewerIsMember && !state.voted,
              voted: state.voted,
              completes: state.votes + 1 >= votesRequired,
            };
          }
        }
        items.push({
          id: base.id,
          at: base.at,
          actor: byAgent ? { kind: "agent" } : { kind: "member", name: who(proposer) },
          text: `${byAgent ? "Propuse" : `${who(proposer)} propuso`} ${what}.${tail}`,
          detail: byAgent ? `Lo que no puedo devolver solo lo tienen que votar: hacen falta ${votesRequired} votos.` : undefined,
          action: voteAction,
        });
        break;
      }
      case "Payment": {
        const { member, amount } = event.args;
        items.push({ ...base, actor: { kind: "group" }, text: `El fondo le pagó ${formatPesos(amount)} a ${who(member)}: la propuesta se aprobó.` });
        break;
      }
      case "MemberAdded": {
        const name = names.get(getAddress(event.args.member)) ?? "una cuenta nueva";
        items.push({ ...base, actor: { kind: "group" }, text: `Se sumó ${name} al fondo.` });
        break;
      }
      case "MemberRemoved":
        items.push({ ...base, actor: { kind: "group" }, text: `${who(event.args.member)} dejó el fondo y se llevó su parte.` });
        break;
      case "MemberReplaced":
        items.push({ ...base, actor: { kind: "group" }, text: `${who(event.args.newMember)} cambió de cuenta.` });
        break;
      case "WeeklyCapChanged":
        cap = event.args.cap;
        items.push({ ...base, actor: { kind: "group" }, text: `El tope semanal de ${agreedExpense} ahora es ${formatPesos(cap)}.` });
        break;
      case "VotesRequiredChanged":
        items.push({ ...base, actor: { kind: "group" }, text: `Ahora hacen falta ${event.args.votes} votos para lo que no es ${agreedExpense}.` });
        break;
      case "AgentChanged":
        items.push({ ...base, actor: { kind: "group" }, text: "Cambió el agente del fondo." });
        break;
      case "FundClosed":
        items.push({ ...base, actor: { kind: "group" }, text: "Se cerró el fondo y se repartió el saldo según lo que aportó cada uno." });
        break;
      case "RemainderDistributed": {
        // Rounding dust after closing, which anyone can "distribute" over and over (spec, 7.3).
        const dust = BigInt(memberCount);
        if (event.args.warsBalance < dust && event.args.usdtBalance < dust) break;
        items.push({ ...base, actor: { kind: "group" }, text: "Se repartió lo que llegó después del cierre." });
        break;
      }
      // VoteCast and ProposalExecuted are folded into their proposal.
    }
  }

  for (const expense of expenses) {
    const what = `el gasto de ${formatPesos(expense.amount)} que cargó ${expense.by}${expense.note ? ` (${expense.note})` : ""}`;
    const text: Partial<Record<ExpenseStatus, string>> = {
      new: `Estoy mirando ${what}.`,
      sending: `Estoy mirando ${what}.`,
      waiting: `Guardé ${what}: lo devuelvo cuando el fondo tenga los pesos.`,
      blocked: `No pude procesar ${what}. Lo vuelvo a intentar en un rato.`,
      rejected: `No puedo devolver ${what}.`,
    };
    const sentence = text[expense.status];
    if (sentence === undefined) continue; // reimbursed or proposed: the chain tells it
    const pendingNow = expense.status === "new" || expense.status === "sending";
    items.push({ id: `expense:${expense.id}`, at: expense.createdAt, actor: { kind: "agent" }, text: sentence, pending: pendingNow || undefined });
  }

  for (const operation of pending) {
    if (operation.kind === "create-fund") continue;
    const text =
      operation.kind === "vote"
        ? "Tu voto está en camino."
        : `Tu aporte de ${operation.token === "usdt" ? formatUsdt(operation.amount ?? 0n) : formatPesos(operation.amount ?? 0n)} está en camino.`;
    items.push({ id: `op:${operation.userOpHash}`, at: operation.createdAt, actor: { kind: "member", name: "Vos" }, text, pending: true });
  }

  return items.sort((x, y) => y.at.getTime() - x.at.getTime());
}

function proposalText(
  action: number,
  a: Address,
  amount: bigint,
  note: string,
  who: (address: Address) => string,
  agreedExpense: string,
): string {
  switch (action) {
    case ProposalAction.Pay:
      return `pagarle ${formatPesos(amount)} a ${who(a)}${note ? ` por ${note}` : ""}`;
    case ProposalAction.AddMember:
      return "sumar a una cuenta nueva al fondo";
    case ProposalAction.RemoveMember:
      return `sacar a ${who(a)} del fondo`;
    case ProposalAction.ReplaceMember:
      return `cambiar la cuenta de ${who(a)}`;
    case ProposalAction.SetWeeklyCap:
      return `cambiar el tope semanal de ${agreedExpense} a ${formatPesos(amount)}`;
    case ProposalAction.SetVotesRequired:
      return `pedir ${amount} votos para lo que no es ${agreedExpense}`;
    case ProposalAction.SetAgent:
      return "cambiar el agente";
    default:
      return "cerrar el fondo y repartir el saldo";
  }
}
