import type { FundEvent, FundSnapshot } from "@tesoreria/agent";
import { type Address, type Hash, getAddress, pad, toHex } from "viem";
import type { BlockClock } from "../../src/lib/chain-time";
import { USDT_UNIT, WARS_UNIT } from "../../src/lib/format";

export { USDT_UNIT };
/** One wARS, short for the amounts below. */
export const WARS = WARS_UNIT;
export const AGENT = getAddress("0x00000000000000000000000000000000000a6e17");
export const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
export const MEMBERS: readonly Address[] = [
  getAddress("0x000000000000000000000000000000000000aaa1"),
  getAddress("0x000000000000000000000000000000000000aaa2"),
  getAddress("0x000000000000000000000000000000000000aaa3"),
];
export const [ANA, BETO, CARO] = MEMBERS as [Address, Address, Address];
export const BLOCK = 80_000_000n;
/** Block BLOCK was made at 2026-10-10 12:00 in Buenos Aires (15:00 UTC). */
export const CLOCK: BlockClock = { block: BLOCK, timestamp: 1_791_644_400n };
export const NOW = new Date(Number(CLOCK.timestamp) * 1000);
/** Two weeks and a bit before CLOCK: the fund is in its week 2. */
export const START = CLOCK.timestamp - 2n * 604_800n - 3_600n;

/** A fund of three in week 2 that each put in 30,000 wARS, nothing spent: one thing changed per test. */
export function snapshot(change: Partial<FundSnapshot> = {}): FundSnapshot {
  return {
    address: FUND,
    block: BLOCK,
    agent: AGENT,
    closed: false,
    members: MEMBERS,
    contributed: [30_000n * WARS, 30_000n * WARS, 30_000n * WARS],
    totalContributed: 90_000n * WARS,
    votesRequired: 2,
    weeklyCap: 60_000n * WARS,
    startTime: START,
    week: 2n,
    spentThisWeek: 0n,
    warsBalance: 90_000n * WARS,
    usdtBalance: 0n,
    ...change,
  };
}

/** One of the fund's events at `block`, in transaction number `tx`. */
export function event<N extends FundEvent["eventName"]>(
  eventName: N,
  args: Extract<FundEvent, { eventName: N }>["args"],
  block: bigint,
  tx = Number(block % 100_000n),
): FundEvent {
  return { eventName, args, blockNumber: block, transactionHash: pad(toHex(tx), { size: 32 }) as Hash, logIndex: 0 } as FundEvent;
}
