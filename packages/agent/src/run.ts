import { type Address, type Hash, formatUnits, isAddressEqual } from "viem";
import { MIN_CONVERSION_USDT, type SkipCode, decideConversion, planConversion } from "./convert";
import { type Currency, servedProblem } from "./currencies";
import { shortMessage } from "./errors";
import type { FundEvent } from "./events";
import { type Expense, decideExpense } from "./expense";
import { type FundRef, type FundSnapshot, weekStartBlock } from "./fund";
import { type AgentAction, type DailyActivity, DAY_BLOCKS, LimitError, authorize, dailyActivity, fundCurrency } from "./limits";
import type { ConversionQuote, References } from "./market";
import type { AgentSigner } from "./signer";

/** Under this much USDT for gas (6 decimals), the agent sends nothing. */
export const MIN_GAS_USDT = 50_000n;

/** What the agent reads from the chain. `createChainView` builds the real one. */
export type ChainView = {
  /** The agent's own USDT, 6 decimals: it pays its gas with it. */
  gasBalance(): Promise<bigint>;
  /** Every fund the factories created, with the version each one runs. */
  funds(): Promise<FundRef[]>;
  fund(ref: FundRef): Promise<FundSnapshot>;
  /** The fund's whole history, up to `toBlock`. */
  events(fund: Address, toBlock: bigint): Promise<FundEvent[]>;
  /** The price references for converting into `currency`: its own feed and USDT / USD. */
  references(currency: Currency): Promise<References>;
  /** What converting `dollarAmount` of the fund's dollar would give, in the fund's currency. */
  quote(fund: FundSnapshot, dollarAmount: bigint): Promise<ConversionQuote>;
  /** Waits for a transaction to be mined. */
  receipt(hash: Hash): Promise<"success" | "reverted">;
};

/**
 * Why an expense waits, when the web has its own words for it: the agent's proposals of the week, shared among the
 * members, have none left for this one, and it's proposed when the next week starts (spec, 8.1).
 */
export type WaitCode = "proposal-quota";

/** A timeline entry: what the agent did, or didn't, and why (spec, 8.6). */
export type Decision = {
  fund?: Address;
  kind: AgentAction["kind"] | "skip" | "wait" | "reject" | "blocked";
  reason: string;
  /** Why a conversion was skipped, or an expense waits, for the web's own words (F8). */
  code?: SkipCode | WaitCode;
  action?: AgentAction;
  tx?: Hash;
  status?: "success" | "reverted";
  /**
   * The send itself threw. The transaction may have gone out all the same: a request that timed out after the node
   * took it, retried as "already known" or "nonce too low". So it's never a plain block to retry: whoever keeps the
   * decision waits until nothing of the agent's is unmined, and then the history shows whether it landed.
   */
  sendFailed?: true;
};

export type AgentContext = {
  chain: ChainView;
  signer: AgentSigner;
  /** Unix seconds. */
  now: () => bigint;
  /** False for a dry run: everything but sending. */
  send: boolean;
  /**
   * Called as soon as a transaction is sent, before its receipt, so the caller can keep the hash even if the
   * wait fails or the process dies. If it throws, the decision still carries the hash, and its reason says the
   * hash was not recorded.
   */
  onSent?: (sent: { fund: Address; action: AgentAction; tx: Hash }) => Promise<void>;
};

/** An amount of the fund's currency in whole units, with its symbol: "1100 wMXN". */
function inCurrency(fund: FundSnapshot, amount: bigint): string {
  const { symbol, decimals } = fundCurrency(fund);
  return `${amount / 10n ** BigInt(decimals)} ${symbol}`;
}

/** An amount of the fund's currency with all its decimals, and its symbol: "0.25 wARS", where whole units would say 0. */
function exactlyInCurrency(fund: FundSnapshot, amount: bigint): string {
  const { symbol, decimals } = fundCurrency(fund);
  return `${formatUnits(amount, decimals)} ${symbol}`;
}

/** Authorizes an action, checks that it would go through and that the agent can pay the gas, and sends it. */
async function act(
  ctx: AgentContext,
  fund: FundSnapshot,
  today: DailyActivity,
  action: AgentAction,
  reason: string,
): Promise<Decision> {
  const blocked = (why: string): Decision => ({ fund: fund.address, kind: "blocked", reason: why, action });
  let tx: ReturnType<typeof authorize>;
  try {
    tx = authorize(action, fund, today, ctx.signer.address);
  } catch (error) {
    if (error instanceof LimitError) return blocked(error.message);
    throw error;
  }
  const gas = await ctx.chain.gasBalance();
  if (gas < MIN_GAS_USDT) {
    return blocked(`The agent holds ${formatUnits(gas, 6)} USDT for gas, under ${formatUnits(MIN_GAS_USDT, 6)}`);
  }
  let maxCost: bigint;
  try {
    ({ maxCost } = await ctx.signer.estimate(tx));
  } catch (error) {
    return blocked(`The transaction would fail: ${shortMessage(error)}`);
  }
  // The fee adapter counts USDT with 18 decimals; the token has 6.
  if (gas * 10n ** 12n < maxCost) return blocked("The agent doesn't hold enough USDT for this transaction's gas");
  if (!ctx.send) return { fund: fund.address, kind: action.kind, reason: `${reason} (dry run: not sent)`, action };
  let hash: Hash;
  try {
    hash = await ctx.signer.send(tx);
  } catch (error) {
    return { ...blocked(`Could not send the transaction: ${shortMessage(error)}`), sendFailed: true };
  }
  // The decision below still carries the hash; a hook that fails leaves its trace in the reason.
  let unrecorded = "";
  try {
    await ctx.onSent?.({ fund: fund.address, action, tx: hash });
  } catch (error) {
    unrecorded = ` (hash not recorded: ${shortMessage(error)})`;
  }
  try {
    const status = await ctx.chain.receipt(hash);
    return { fund: fund.address, kind: action.kind, reason: `${reason}${unrecorded}`, action, tx: hash, status };
  } catch (error) {
    // The transaction went out: keep its hash so the timeline doesn't call it blocked.
    return {
      fund: fund.address,
      kind: action.kind,
      reason: `${reason}${unrecorded} (sent; receipt unknown: ${shortMessage(error)})`,
      action,
      tx: hash,
    };
  }
}

/** Whether the fund's fee was sent since its current week began, as its history says. */
function feePaidThisWeek(fund: FundSnapshot, events: readonly FundEvent[]): boolean {
  const since = weekStartBlock(fund);
  return events.some((e) => e.eventName === "FeePaid" && e.blockNumber >= since);
}

/** A fund's history up to its snapshot's block, and the agent's activity over the last day. */
async function history(ctx: AgentContext, fund: FundSnapshot) {
  const events = await ctx.chain.events(fund.address, fund.block);
  const today = dailyActivity(events, ctx.signer.address, fund.block - DAY_BLOCKS);
  return { events, today };
}

/**
 * The periodic run (spec, 8.3): converts the USDT waiting in each open fund this agent runs and serves (a v2 fund
 * that doesn't match the table is left alone, with no entry). In version 2 that's the USDT members have pending, in
 * one transaction for all of them; what was sent straight to the fund is nobody's and stays. A fund that fails to
 * load becomes a "blocked" entry and the others go on.
 */
export async function runHeartbeat(ctx: AgentContext): Promise<Decision[]> {
  const decisions: Decision[] = [];
  // Each currency's references, read once per heartbeat for every fund in it.
  const references = new Map<Currency["symbol"], References>();
  let funds: FundRef[];
  try {
    funds = await ctx.chain.funds();
  } catch (error) {
    return [{ kind: "blocked", reason: `Could not list the funds: ${shortMessage(error)}` }];
  }
  for (const ref of funds) {
    const { address } = ref;
    try {
      // The snapshot first: another agent's fund, one with nothing to convert and no fee to send costs no history read.
      const fund = await ctx.chain.fund(ref);
      if (!isAddressEqual(fund.agent, ctx.signer.address)) continue;
      // Anyone can deploy a fund that names this agent: one that doesn't match the table costs no history read either.
      if (servedProblem(fund) !== null) continue;
      // The fee goes out once a week, from week 1, open fund or closed (the contract lets it: the last one is still owed).
      const feeDue = fund.version === 2 && fund.week >= 1n && fund.feeOwed > 0n;
      // What's waiting to be converted: in version 2 only the members' pending dollars (the balance has what was sent directly).
      const converts = !fund.closed && (fund.version === 2 ? fund.totalPendingDollar : fund.dollarBalance) >= MIN_CONVERSION_USDT;
      if (!feeDue && !converts) continue;
      const { events, today: sentBefore } = await history(ctx, fund);
      let today = sentBefore;
      if (feeDue && !feePaidThisWeek(fund, events)) {
        const fee = await act(ctx, fund, today, { kind: "pay-fee" }, `Send the fund's fee: ${exactlyInCurrency(fund, fund.feeOwed)}`);
        decisions.push(fee);
        // Sent, so it's one of the day's transactions the conversion below has to count (the history was read before it).
        if (fee.tx !== undefined) today = { ...today, transactions: today.transactions + 1 };
      }
      if (!converts) continue;
      const plan = planConversion(fund, today);
      if (plan.kind === "none") continue;
      if (plan.kind === "skip") {
        decisions.push({ fund: address, kind: "skip", code: plan.code, reason: plan.reason });
        continue;
      }
      const currency = fundCurrency(fund);
      let prices = references.get(currency.symbol);
      if (prices === undefined) {
        prices = await ctx.chain.references(currency);
        references.set(currency.symbol, prices);
      }
      const quote = await ctx.chain.quote(fund, plan.dollarAmount);
      const decision = decideConversion({ quote, references: prices, currency, now: ctx.now() });
      if (decision.kind === "skip") {
        decisions.push({ fund: address, kind: "skip", code: decision.code, reason: decision.reason });
        continue;
      }
      const { dollarAmount, minCurrencyOut } = decision;
      const reason = `Convert ${formatUnits(dollarAmount, 6)} USDT to at least ${inCurrency(fund, minCurrencyOut)}`;
      // A version 2 plan says whose dollars; a version 1 one has no members to name.
      const members = plan.members === undefined || plan.amounts === undefined ? {} : { members: plan.members, amounts: plan.amounts };
      decisions.push(await act(ctx, fund, today, { kind: "convert", dollarAmount, minCurrencyOut, ...members }, reason));
    } catch (error) {
      decisions.push({ fund: address, kind: "blocked", reason: `Could not run the fund: ${shortMessage(error)}` });
    }
  }
  return decisions;
}

/**
 * What the web app calls after a member enters an expense (spec, 8.1 and 8.3). `claimed` are the transactions it
 * recorded for the fund's other expenses: a proposal made in one of them is never this expense's (decideExpense).
 */
export async function handleExpense(ctx: AgentContext, address: Address, expense: Expense, claimed: readonly Hash[] = []): Promise<Decision> {
  try {
    // Only the factories' funds: for any other contract, the history and the gas cost are its own to choose.
    const funds = await ctx.chain.funds();
    const ref = funds.find((f) => isAddressEqual(f.address, address));
    if (ref === undefined) {
      return { fund: address, kind: "reject", reason: "That fund wasn't created by TesorerIA's FundFactory" };
    }
    const fund = await ctx.chain.fund(ref);
    if (!isAddressEqual(fund.agent, ctx.signer.address)) {
      return { fund: address, kind: "reject", reason: "This agent doesn't run that fund" };
    }
    // Blocked, not rejected: a rejection is final, and the fund is served once the table says so.
    const problem = servedProblem(fund);
    if (problem !== null) return { fund: address, kind: "blocked", reason: problem };
    const { events, today } = await history(ctx, fund);
    const decision = decideExpense({ expense, fund, events, today, now: ctx.now(), claimed });
    switch (decision.kind) {
      case "reject":
        return { fund: address, kind: "reject", reason: decision.reason };
      case "wait":
        return { fund: address, kind: "wait", reason: decision.reason, ...(decision.code === undefined ? {} : { code: decision.code }) };
      case "proposed": {
        // On chain already: as if this run had proposed it, in that transaction.
        const kind = fund.version === 2 && expense.kind === "give-back" ? "propose-give-back" : "propose-payment";
        return { fund: address, kind, reason: decision.reason, tx: decision.transactionHash, status: "success" };
      }
      case "reimburse": {
        const { member, amount, ref } = decision;
        const reason = `Pay back ${inCurrency(fund, amount)} of the agreed expense`;
        return await act(ctx, fund, today, { kind: "reimburse", member, amount, ref }, reason);
      }
      case "propose-payment": {
        const { member, amount, note, reason } = decision;
        return await act(ctx, fund, today, { kind: "propose-payment", member, amount, note }, reason);
      }
      case "propose-give-back": {
        const { member, amount, note, reason } = decision;
        return await act(ctx, fund, today, { kind: "propose-give-back", member, amount, note }, reason);
      }
    }
  } catch (error) {
    return { fund: address, kind: "blocked", reason: `Could not handle the expense: ${shortMessage(error)}` };
  }
}
