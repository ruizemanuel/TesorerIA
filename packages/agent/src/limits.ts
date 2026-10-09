import { type Address, type Hash, type Hex, encodeFunctionData, isAddressEqual, zeroAddress } from "viem";
import { Action, fundAbi } from "./abi";
import type { FundEvent } from "./events";
import type { FundSnapshot } from "./fund";
import type { AgentTransaction } from "./signer";

const WARS_UNIT = 10n ** 18n;
const USDT_UNIT = 10n ** 6n;

/**
 * The agent's own limits, on top of the contract's (members only, weekly cap). They hold per fund, and
 * "a day" is the last DAY_BLOCKS blocks. A reimbursement over a limit becomes a proposal for the members
 * to vote on, never a payment.
 */
export const LIMITS = {
  maxReimbursementWars: 100_000n * WARS_UNIT,
  maxDailyReimbursedWars: 150_000n * WARS_UNIT,
  maxConversionUsdt: 500n * USDT_UNIT,
  maxDailyConvertedUsdt: 1_000n * USDT_UNIT,
  /** Transactions per fund and day, so a bug can't spend the agent's gas money. */
  maxDailyTransactions: 20,
} as const;

/** Celo makes one block per second, so a day is 86,400 blocks. */
export const DAY_BLOCKS = 86_400n;

/** The longest note the agent writes on chain, in characters. */
export const MAX_NOTE_LENGTH = 140;

/** What the agent did in a fund over the last day, from the fund's events. */
export type DailyActivity = { reimbursedWars: bigint; convertedUsdt: bigint; transactions: number };

/** Sums the fund's agent activity in the blocks after `sinceBlock`. */
export function dailyActivity(events: readonly FundEvent[], agent: Address, sinceBlock: bigint): DailyActivity {
  let reimbursedWars = 0n;
  let convertedUsdt = 0n;
  const transactions = new Set<Hash>();
  for (const event of events) {
    if (event.blockNumber <= sinceBlock) continue;
    if (event.eventName === "Reimbursement") {
      reimbursedWars += event.args.amount;
      transactions.add(event.transactionHash);
    } else if (event.eventName === "Conversion") {
      convertedUsdt += event.args.usdtIn;
      transactions.add(event.transactionHash);
    } else if (event.eventName === "ProposalCreated" && isAddressEqual(event.args.proposer, agent)) {
      transactions.add(event.transactionHash);
    }
  }
  return { reimbursedWars, convertedUsdt, transactions: transactions.size };
}

/** Something the agent can do in a fund. */
export type AgentAction =
  | { kind: "convert"; usdtAmount: bigint; minWarsOut: bigint }
  | { kind: "reimburse"; member: Address; amount: bigint; ref: Hex }
  | { kind: "propose-payment"; member: Address; amount: bigint; note: string };

/** An action that a limit stops. Its message says which, for the timeline. */
export class LimitError extends Error {
  override name = "LimitError";
}

/** The member as the contract lists it: the agent never takes an address from anywhere else. */
function listedMember(fund: FundSnapshot, address: Address): Address {
  const member = fund.members.find((m) => isAddressEqual(m, address));
  if (member === undefined) throw new LimitError(`${address} is not a member of the fund`);
  return member;
}

/**
 * The only way to turn an action into a transaction: checks it against the fund's state and the agent's
 * limits, and encodes it. Throws LimitError when something doesn't hold.
 */
export function authorize(
  action: AgentAction,
  fund: FundSnapshot,
  today: DailyActivity,
  agent: Address,
): AgentTransaction {
  if (!isAddressEqual(fund.agent, agent)) throw new LimitError("This wallet is not the fund's agent");
  if (fund.closed) throw new LimitError("The fund is closed");
  if (today.transactions >= LIMITS.maxDailyTransactions) {
    throw new LimitError(`The agent already sent ${today.transactions} transactions for this fund in the last day`);
  }
  switch (action.kind) {
    case "convert": {
      const { usdtAmount, minWarsOut } = action;
      if (usdtAmount <= 0n || minWarsOut <= 0n) throw new LimitError("Nothing to convert");
      if (usdtAmount > fund.usdtBalance) throw new LimitError("The fund doesn't hold that much USDT");
      if (usdtAmount > LIMITS.maxConversionUsdt) throw new LimitError("Above the agent's per-conversion limit");
      if (today.convertedUsdt + usdtAmount > LIMITS.maxDailyConvertedUsdt) {
        throw new LimitError("Above the agent's daily conversion limit");
      }
      return {
        to: fund.address,
        data: encodeFunctionData({ abi: fundAbi, functionName: "convert", args: [usdtAmount, minWarsOut] }),
      };
    }
    case "reimburse": {
      const member = listedMember(fund, action.member);
      const { amount, ref } = action;
      if (amount <= 0n) throw new LimitError("Nothing to reimburse");
      if (amount > LIMITS.maxReimbursementWars) throw new LimitError("Above the agent's per-reimbursement limit");
      if (today.reimbursedWars + amount > LIMITS.maxDailyReimbursedWars) {
        throw new LimitError("Above the agent's daily reimbursement limit");
      }
      if (fund.spentThisWeek + amount > fund.weeklyCap) throw new LimitError("Above what's left of this week's cap");
      if (amount > fund.warsBalance) throw new LimitError("The fund doesn't hold that much wARS");
      return {
        to: fund.address,
        data: encodeFunctionData({ abi: fundAbi, functionName: "reimburseAgreedExpense", args: [member, amount, ref] }),
      };
    }
    case "propose-payment": {
      const member = listedMember(fund, action.member);
      const { amount, note } = action;
      if (amount <= 0n) throw new LimitError("Nothing to pay");
      if ([...note].length > MAX_NOTE_LENGTH) throw new LimitError(`Notes are at most ${MAX_NOTE_LENGTH} characters`);
      return {
        to: fund.address,
        data: encodeFunctionData({
          abi: fundAbi,
          functionName: "propose",
          args: [Action.Pay, member, zeroAddress, amount, note],
        }),
      };
    }
  }
}
