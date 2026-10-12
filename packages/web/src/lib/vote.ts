import type { Call } from "@tesoreria/wallet";
import { type Address, encodeFunctionData } from "viem";
import { isOnItsWay, wasCancelled } from "./client/errors";
import { memberFundAbi } from "./fund-abi";

type Vote = { fund: Address; proposalId: bigint; completes: boolean };

/** A member's vote; when it completes the votes needed, the execution goes in the same operation. */
export function voteCalls({ fund, proposalId, completes }: Vote): Call[] {
  const call = (functionName: "vote" | "execute") => ({
    to: fund,
    data: encodeFunctionData({ abi: memberFundAbi, functionName, args: [proposalId] }),
  });
  return completes ? [call("vote"), call("execute")] : [call("vote")];
}

/** Executes a proposal that has its votes but didn't run with the last one (spec, 7.3: anyone may). */
export function executeCalls({ fund, proposalId }: { fund: Address; proposalId: bigint }): Call[] {
  return [{ to: fund, data: encodeFunctionData({ abi: memberFundAbi, functionName: "execute", args: [proposalId] }) }];
}

/**
 * Casts the vote through `send`, which sends one operation. If the vote that completes the count fails with its
 * execution in it (the fund may be short, so the execution reverts and takes the whole operation with it), it is
 * sent alone and the proposal waits, ready to run. Never a second time when the person cancelled the confirmation
 * or the first operation went out and may still land.
 */
export async function castVote(send: (calls: Call[]) => Promise<unknown>, vote: Vote): Promise<void> {
  try {
    await send(voteCalls(vote));
  } catch (first) {
    if (!vote.completes || wasCancelled(first) || isOnItsWay(first)) throw first;
    await send(voteCalls({ ...vote, completes: false }));
  }
}
