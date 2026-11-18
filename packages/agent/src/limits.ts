import { type Address, type Hash, type Hex, encodeFunctionData, isAddressEqual, zeroAddress } from "viem";
import { Action, fundAbi, fundV2Abi } from "./abi";
import { type Currency, currencyOf } from "./currencies";
import type { FundEvent } from "./events";
import type { FundSnapshot } from "./fund";
import type { AgentTransaction } from "./signer";

/**
 * The agent's own limits that don't depend on a fund's currency, on top of the contract's (members only, weekly
 * cap). They hold per fund, and "a day" is the last DAY_BLOCKS blocks. A reimbursement over a limit becomes a
 * proposal for the members to vote on, never a payment. The dollar ones are in whole dollars: `conversionLimits` gives
 * them in the fund's dollar token, and each currency's reimbursement limits are in `CURRENCIES`.
 */
export const LIMITS = {
  maxConversionDollar: 500n,
  maxDailyConvertedDollar: 1_000n,
  /** Transactions per fund and day, so a bug can't spend the agent's gas money. */
  maxDailyTransactions: 20,
} as const;

/** Celo makes one block per second, so a day is 86,400 blocks. */
export const DAY_BLOCKS = 86_400n;

/** The longest note the agent writes on chain, in characters. */
export const MAX_NOTE_LENGTH = 140;

/** What the agent did in a fund over the last day, from the fund's events. */
export type DailyActivity = { reimbursed: bigint; convertedDollar: bigint; transactions: number };

/** Sums the fund's agent activity in the blocks after `sinceBlock`. */
export function dailyActivity(events: readonly FundEvent[], agent: Address, sinceBlock: bigint): DailyActivity {
  let reimbursed = 0n;
  let convertedDollar = 0n;
  const transactions = new Set<Hash>();
  for (const event of events) {
    if (event.blockNumber <= sinceBlock) continue;
    if (event.eventName === "Reimbursement") {
      reimbursed += event.args.amount;
      transactions.add(event.transactionHash);
    } else if (event.eventName === "Conversion") {
      convertedDollar += event.args.dollarIn;
      transactions.add(event.transactionHash);
    } else if (event.eventName === "ProposalCreated" && isAddressEqual(event.args.proposer, agent)) {
      transactions.add(event.transactionHash);
    }
  }
  return { reimbursed, convertedDollar, transactions: transactions.size };
}

/**
 * Something the agent can do in a fund. A version 2 `convert` also names the members whose pending dollars it takes
 * and how much of each (`amounts` adds up to `dollarAmount`); a version 1 one names none.
 */
export type AgentAction =
  | { kind: "convert"; dollarAmount: bigint; minCurrencyOut: bigint; members?: readonly Address[]; amounts?: readonly bigint[] }
  | { kind: "reimburse"; member: Address; amount: bigint; ref: Hex }
  | { kind: "propose-payment"; member: Address; amount: bigint; note: string };

/** An action that a limit stops. Its message says which, for the timeline. */
export class LimitError extends Error {
  override name = "LimitError";
}

/** The table's entry for the fund's currency, or a LimitError: the agent has no limits for a currency it doesn't know. */
export function fundCurrency(fund: FundSnapshot): Currency {
  const currency = currencyOf(fund.currency);
  if (currency === undefined) throw new LimitError(`The fund's currency ${fund.currency} isn't in the agent's table`);
  return currency;
}

/** What the agent may reimburse in one transaction and in a day, in the fund's currency (its token's units). */
export function reimbursementLimits(fund: FundSnapshot): { perReimbursement: bigint; perDay: bigint } {
  const { limits } = fundCurrency(fund);
  return { perReimbursement: limits.reimbursement, perDay: limits.dailyReimbursed };
}

/** What the agent may convert in one transaction and in a day, in the fund's dollar token's units. */
export function conversionLimits(fund: FundSnapshot): { perConversion: bigint; perDay: bigint } {
  const { dollar } = fundCurrency(fund);
  if (fund.dollar === null || dollar === null) throw new LimitError("The fund has no dollar to convert");
  const unit = 10n ** BigInt(dollar.decimals);
  return { perConversion: LIMITS.maxConversionDollar * unit, perDay: LIMITS.maxDailyConvertedDollar * unit };
}

/** The member as the contract lists it: the agent never takes an address from anywhere else. */
function listedMember(fund: FundSnapshot, address: Address): Address {
  const member = fund.members.find((m) => isAddressEqual(m, address));
  if (member === undefined) throw new LimitError(`${address} is not a member of the fund`);
  return member;
}

/**
 * The members and amounts of a version 2 conversion as the contract takes them: each member listed (as the contract
 * lists them), once, with a positive amount that is at most what they have pending, and the amounts adding up to
 * `dollarAmount`. Throws a LimitError when something doesn't hold.
 */
function conversionParts(
  fund: FundSnapshot,
  dollarAmount: bigint,
  members: readonly Address[] | undefined,
  amounts: readonly bigint[] | undefined,
): { members: Address[]; amounts: bigint[] } {
  if (members === undefined || amounts === undefined || members.length === 0) {
    throw new LimitError("A conversion in a version 2 fund names no member");
  }
  if (members.length !== amounts.length) throw new LimitError("A conversion needs the same number of members and amounts");
  const listed: Address[] = [];
  for (const [i, address] of members.entries()) {
    const member = listedMember(fund, address);
    const amount = amounts[i] ?? 0n;
    if (amount <= 0n) throw new LimitError("Nothing to convert");
    if (listed.includes(member)) throw new LimitError(`${member} is in the conversion twice`);
    const pending = fund.pendingDollar[fund.members.indexOf(member)] ?? 0n;
    if (amount > pending) throw new LimitError(`The conversion takes more than ${member} has pending (${pending})`);
    listed.push(member);
  }
  if (amounts.reduce((sum, amount) => sum + amount, 0n) !== dollarAmount) {
    throw new LimitError("The members' amounts don't add up to the amount to convert");
  }
  return { members: listed, amounts: [...amounts] };
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
      const { dollarAmount, minCurrencyOut, members, amounts } = action;
      if (dollarAmount <= 0n || minCurrencyOut <= 0n) throw new LimitError("Nothing to convert");
      // Version 2 converts what members have pending, which `conversionParts` checks one by one; version 1, what the fund holds.
      const parts = fund.version === 2 ? conversionParts(fund, dollarAmount, members, amounts) : undefined;
      if (parts === undefined) {
        if (members !== undefined || amounts !== undefined) throw new LimitError("A conversion in a version 1 fund names no members");
        if (dollarAmount > fund.dollarBalance) throw new LimitError("The fund doesn't hold that much USDT");
      }
      const { perConversion, perDay } = conversionLimits(fund);
      if (dollarAmount > perConversion) throw new LimitError("Above the agent's per-conversion limit");
      if (today.convertedDollar + dollarAmount > perDay) {
        throw new LimitError("Above the agent's daily conversion limit");
      }
      const data =
        parts === undefined
          ? encodeFunctionData({ abi: fundAbi, functionName: "convert", args: [dollarAmount, minCurrencyOut] })
          : encodeFunctionData({ abi: fundV2Abi, functionName: "convert", args: [parts.members, parts.amounts, minCurrencyOut] });
      return { to: fund.address, data };
    }
    case "reimburse": {
      const member = listedMember(fund, action.member);
      const { amount, ref } = action;
      if (amount <= 0n) throw new LimitError("Nothing to reimburse");
      const { perReimbursement, perDay } = reimbursementLimits(fund);
      if (amount > perReimbursement) throw new LimitError("Above the agent's per-reimbursement limit");
      if (today.reimbursed + amount > perDay) {
        throw new LimitError("Above the agent's daily reimbursement limit");
      }
      if (fund.spentThisWeek + amount > fund.weeklyCap) throw new LimitError("Above what's left of this week's cap");
      if (amount > fund.currencyBalance) throw new LimitError(`The fund doesn't hold that much ${fundCurrency(fund).symbol}`);
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
