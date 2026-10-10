import { type Address, type Hash, formatUnits, isAddressEqual } from "viem";
import { MIN_CONVERSION_USDT, decideConversion, planConversion } from "./convert";
import { shortMessage } from "./errors";
import type { FundEvent } from "./events";
import { type Expense, decideExpense } from "./expense";
import type { FundSnapshot } from "./fund";
import { type AgentAction, type DailyActivity, DAY_BLOCKS, LimitError, authorize, dailyActivity } from "./limits";
import type { ConversionQuote, References } from "./market";
import type { AgentSigner } from "./signer";

/** Under this much USDT for gas (6 decimals), the agent sends nothing. */
export const MIN_GAS_USDT = 50_000n;

/** What the agent reads from the chain. `createChainView` builds the real one. */
export type ChainView = {
  /** The agent's own USDT, 6 decimals: it pays its gas with it. */
  gasBalance(): Promise<bigint>;
  /** Every fund the factory created. */
  funds(): Promise<Address[]>;
  fund(address: Address): Promise<FundSnapshot>;
  /** The fund's whole history, up to `toBlock`. */
  events(fund: Address, toBlock: bigint): Promise<FundEvent[]>;
  references(): Promise<References>;
  quote(fund: Address, usdtAmount: bigint): Promise<ConversionQuote>;
  /** Waits for a transaction to be mined. */
  receipt(hash: Hash): Promise<"success" | "reverted">;
};

/** A timeline entry: what the agent did, or didn't, and why (spec, 8.6). */
export type Decision = {
  fund?: Address;
  kind: AgentAction["kind"] | "skip" | "wait" | "reject" | "blocked";
  reason: string;
  action?: AgentAction;
  tx?: Hash;
  status?: "success" | "reverted";
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
   * wait fails or the process dies. If it throws, the decision still carries the hash.
   */
  onSent?: (sent: { fund: Address; action: AgentAction; tx: Hash }) => Promise<void>;
};

function wholeWars(amount: bigint): string {
  return (amount / 10n ** 18n).toString();
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
    return blocked(`Could not send the transaction: ${shortMessage(error)}`);
  }
  try {
    await ctx.onSent?.({ fund: fund.address, action, tx: hash });
  } catch {} // the decision below still carries the hash
  try {
    const status = await ctx.chain.receipt(hash);
    return { fund: fund.address, kind: action.kind, reason, action, tx: hash, status };
  } catch (error) {
    // The transaction went out: keep its hash so the timeline doesn't call it blocked.
    return {
      fund: fund.address,
      kind: action.kind,
      reason: `${reason} (sent; receipt unknown: ${shortMessage(error)})`,
      action,
      tx: hash,
    };
  }
}

/** A fund's history up to its snapshot's block, and the agent's activity over the last day. */
async function history(ctx: AgentContext, fund: FundSnapshot) {
  const events = await ctx.chain.events(fund.address, fund.block);
  const today = dailyActivity(events, ctx.signer.address, fund.block - DAY_BLOCKS);
  return { events, today };
}

/**
 * The periodic run (spec, 8.3): converts the USDT waiting in each open fund this agent runs. A fund that fails
 * to load becomes a "blocked" entry and the others go on.
 */
export async function runHeartbeat(ctx: AgentContext): Promise<Decision[]> {
  const decisions: Decision[] = [];
  let references: References | undefined;
  let funds: Address[];
  try {
    funds = await ctx.chain.funds();
  } catch (error) {
    return [{ kind: "blocked", reason: `Could not list the funds: ${shortMessage(error)}` }];
  }
  for (const address of funds) {
    try {
      // The snapshot first: a closed fund, another agent's, or one with nothing to convert costs no history read.
      const fund = await ctx.chain.fund(address);
      if (fund.closed || !isAddressEqual(fund.agent, ctx.signer.address)) continue;
      if (fund.usdtBalance < MIN_CONVERSION_USDT) continue;
      const { today } = await history(ctx, fund);
      const plan = planConversion(fund, today);
      if (plan.kind === "none") continue;
      if (plan.kind === "skip") {
        decisions.push({ fund: address, kind: "skip", reason: plan.reason });
        continue;
      }
      references ??= await ctx.chain.references();
      const quote = await ctx.chain.quote(address, plan.usdtAmount);
      const decision = decideConversion({ quote, references, now: ctx.now() });
      if (decision.kind === "skip") {
        decisions.push({ fund: address, kind: "skip", reason: decision.reason });
        continue;
      }
      const { usdtAmount, minWarsOut } = decision;
      const reason = `Convert ${formatUnits(usdtAmount, 6)} USDT to at least ${wholeWars(minWarsOut)} wARS`;
      decisions.push(await act(ctx, fund, today, { kind: "convert", usdtAmount, minWarsOut }, reason));
    } catch (error) {
      decisions.push({ fund: address, kind: "blocked", reason: `Could not run the fund: ${shortMessage(error)}` });
    }
  }
  return decisions;
}

/** What the web app calls after a member enters an expense (spec, 8.1 and 8.3). */
export async function handleExpense(ctx: AgentContext, address: Address, expense: Expense): Promise<Decision> {
  try {
    // Only the factory's funds: for any other contract, the history and the gas cost are its own to choose.
    const funds = await ctx.chain.funds();
    if (!funds.some((f) => isAddressEqual(f, address))) {
      return { fund: address, kind: "reject", reason: "That fund wasn't created by TesorerIA's FundFactory" };
    }
    const fund = await ctx.chain.fund(address);
    if (!isAddressEqual(fund.agent, ctx.signer.address)) {
      return { fund: address, kind: "reject", reason: "This agent doesn't run that fund" };
    }
    const { events, today } = await history(ctx, fund);
    const decision = decideExpense({ expense, fund, events, today });
    switch (decision.kind) {
      case "reject":
      case "wait":
        return { fund: address, kind: decision.kind, reason: decision.reason };
      case "reimburse": {
        const { member, amount, ref } = decision;
        const reason = `Pay back ${wholeWars(amount)} wARS of the agreed expense`;
        return await act(ctx, fund, today, { kind: "reimburse", member, amount, ref }, reason);
      }
      case "propose-payment": {
        const { member, amount, note, reason } = decision;
        return await act(ctx, fund, today, { kind: "propose-payment", member, amount, note }, reason);
      }
    }
  } catch (error) {
    return { fund: address, kind: "blocked", reason: `Could not handle the expense: ${shortMessage(error)}` };
  }
}
