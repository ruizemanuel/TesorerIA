/**
 * The cap of the paymaster's sponsorship policy that `message` says was reached, or null. Pimlico words it as it did
 * to every pm_getPaymasterData of an account that had used its 30 operations on 14/11/2026: "sponsorshipPolicy
 * perUserMaximumOpCount reached" (code -32602). Only that cap has been seen; a cap whose name starts with "perUser"
 * is the account's, any other is the whole policy's. Trying again doesn't help until the cap resets or is raised.
 */
export function sponsorCapIn(message: string): string | null {
  return /\bsponsorshipPolicy (\w+) reached\b/.exec(message)?.[1] ?? null;
}

/** Whether `cap` (from `sponsorCapIn`) is one account's, rather than the whole policy's. */
export function isAccountCap(cap: string): boolean {
  return cap.startsWith("perUser");
}
