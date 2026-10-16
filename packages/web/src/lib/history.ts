import type { FundEvent, FundSnapshot } from "@tesoreria/agent";

/** The history read doesn't add up: some event is missing, so nothing is shown from it. */
export class HistoryGapError extends Error {
  override name = "HistoryGapError";
}

/**
 * Only reimbursements add to spentInWeek (Fund.sol), so this week's Reimbursement events must sum to it.
 * If they don't, the history read has a hole.
 */
export function checkHistory(snapshot: FundSnapshot, events: readonly FundEvent[]): void {
  let reimbursed = 0n;
  for (const e of events) if (e.eventName === "Reimbursement" && e.args.week === snapshot.week) reimbursed += e.args.amount;
  if (reimbursed !== snapshot.spentThisWeek) {
    throw new HistoryGapError(`This week's reimbursements add up to ${reimbursed}, but spentInWeek is ${snapshot.spentThisWeek}`);
  }
}
