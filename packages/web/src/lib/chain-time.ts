/** Celo's first block as an L2 (2025-03-26): from it on, exactly one block per second (checked 2026-10-10). */
export const CELO_L2_FIRST_BLOCK = 31_056_500n;
const WEEK = 604_800n;

/** A block whose time is known, usually the one a fund's snapshot was read at. */
export type BlockClock = { block: bigint; timestamp: bigint };

/** When `block` was made: one second per block back from `clock`, so no block has to be fetched. */
export function blockTime(block: bigint, clock: BlockClock): Date {
  if (block < CELO_L2_FIRST_BLOCK) throw new Error(`Block ${block} is before Celo's L2 blocks`);
  return new Date(Number(clock.timestamp - (clock.block - block)) * 1000);
}

/** The fund's week at `date`, like Fund.currentWeek: (timestamp - startTime) / WEEK. */
export function weekAt(date: Date, startTime: bigint): bigint {
  return (BigInt(Math.floor(date.getTime() / 1000)) - startTime) / WEEK;
}
