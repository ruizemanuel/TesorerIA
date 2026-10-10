import { pad } from "viem";
import { describe, expect, it } from "vitest";
import { HistoryGapError, checkHistory } from "../src/lib/read-fund";
import { ANA, BETO, BLOCK, WARS, event, snapshot } from "./support/fixtures";

describe("checkHistory", () => {
  const paid = (amount: bigint, week: bigint, n: number) =>
    event("Reimbursement", { member: n % 2 ? ANA : BETO, amount, ref: pad(`0x0${n}`, { size: 32 }), week }, BLOCK - BigInt(n));

  it("accepts a history whose reimbursements this week add up to the contract's spentInWeek", () => {
    expect(() => checkHistory(snapshot({ spentThisWeek: 45_000n * WARS }), [paid(30_000n * WARS, 1n, 1), paid(45_000n * WARS, 2n, 2)])).not.toThrow();
    expect(() => checkHistory(snapshot(), [])).not.toThrow();
  });

  it("stops on a history that misses a reimbursement", () => {
    expect(() => checkHistory(snapshot({ spentThisWeek: 45_000n * WARS }), [])).toThrow(HistoryGapError);
  });
});
