import type { FundEvent } from "@tesoreria/agent";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { expenses } from "./db/schema";

/**
 * The transactions the agent proposed the fund's "give-back" expenses in (spec, 7.3), lowercase: each expense keeps
 * its own (`tx`, with `sentAction` "propose-payment"). The chain can't tell a contribution given back from any other
 * payment: only the app knows what the expense was.
 */
export async function giveBackTransactions(db: Db, fundId: string): Promise<Set<string>> {
  const rows = await db
    .select({ tx: expenses.tx })
    .from(expenses)
    .where(and(eq(expenses.fundId, fundId), eq(expenses.kind, "give-back"), eq(expenses.sentAction, "propose-payment"), isNotNull(expenses.tx)));
  return new Set(rows.map((row) => row.tx!.toLowerCase()));
}

/** The proposals (by id) created in `txs` (lowercase): with giveBackTransactions, the ones that gave a contribution back. */
export function proposalsIn(events: readonly FundEvent[], txs: ReadonlySet<string>): Set<bigint> {
  const ids = new Set<bigint>();
  for (const event of events) {
    if (event.eventName === "ProposalCreated" && txs.has(event.transactionHash.toLowerCase())) ids.add(event.args.id);
  }
  return ids;
}
