/**
 * Where the balance counts up from after your contribution (spec, 9.2, the one moment), or null to just show `to`.
 * It plays once: while the balance it's given is still the one from before (a node behind) it waits, and once it has
 * played, a later refresh (another member's contribution, the agent's conversion) only updates the number.
 */
export function countUpStart({ played, from, to, reducedMotion }: { played: boolean; from: bigint; to: bigint; reducedMotion: boolean }): bigint | null {
  if (played || reducedMotion || from === to) return null;
  return from;
}
