import { describe, expect, it } from "vitest";
import { CELO_L2_FIRST_BLOCK, blockTime, weekAt } from "../src/lib/chain-time";

describe("blockTime", () => {
  it("counts one second per block from a block whose time is known", () => {
    // Read from forno on 2026-10-10: block 79,659,548 was made at 1,791,560,306.
    const clock = { block: 79_698_932n, timestamp: 1_791_599_690n };
    expect(blockTime(79_659_548n, clock).getTime()).toBe(1_791_560_306_000);
    expect(blockTime(CELO_L2_FIRST_BLOCK, clock).getTime()).toBe(1_742_957_258_000);
    expect(() => blockTime(CELO_L2_FIRST_BLOCK - 1n, clock)).toThrow("before Celo's L2 blocks");
  });

  it("gives the fund's week like Fund.currentWeek", () => {
    const start = 1_791_000_000n;
    expect(weekAt(new Date(1_791_000_000_000), start)).toBe(0n);
    expect(weekAt(new Date((1_791_000_000 + 604_799) * 1000), start)).toBe(0n);
    expect(weekAt(new Date((1_791_000_000 + 604_800) * 1000), start)).toBe(1n);
  });
});
