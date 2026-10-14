import { USDT, WARS } from "@tesoreria/agent";
import { type Address, type PublicClient, erc20Abi } from "viem";
import { waitForBlock } from "./read-your-writes";

/**
 * What a pass to pesos tells the page (a CustomEvent on `window`, with the receipt's block as its detail, or
 * undefined when the receipt had none): the member's account changed, so whatever shows it reads it again.
 */
export const ACCOUNT_CHANGED = "tesoreria:account-changed";

export type Balances = { wars: bigint; usdt: bigint };
export type BalanceClient = Pick<PublicClient, "readContract" | "getBlockNumber">;

/**
 * Reads what `account` holds and hands each read to `onRead`: null when it failed, so whoever shows it keeps the last.
 * After a change (`changed`, with the block it landed in), it waits for the node to have that block (read-your-writes,
 * spec 9.2: Forno can be a block or two behind the bundler), skips the routine looks meanwhile, and drops any read
 * begun before the change: a pass's old balance must never come back after it, or the panel would offer it again.
 */
export function accountReader(client: BalanceClient, account: Address, onRead: (balances: Balances | null) => void) {
  let changes = 0; // a read begun under an older count says nothing new
  let waiting = false;
  let stopped = false;

  const read = async (generation: number) => {
    let balances: Balances | null;
    try {
      const [wars, usdt] = await Promise.all([
        client.readContract({ address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      ]);
      balances = { wars, usdt };
    } catch {
      balances = null;
    }
    if (!stopped && generation === changes) onRead(balances);
  };

  return {
    /** A routine look, skipped while a change is being waited for. */
    look: (): Promise<void> => (waiting ? Promise.resolve() : read(changes)),
    /** The account changed in `block`: read it once the node has that block, or gave up waiting for it. */
    changed: async (block: bigint | undefined, sleep?: (ms: number) => Promise<void>): Promise<void> => {
      const generation = ++changes;
      waiting = true;
      if (block !== undefined) await waitForBlock(client, block, sleep);
      if (generation !== changes) return; // a later change took over
      waiting = false;
      await read(generation);
    },
    stop: (): void => {
      stopped = true;
    },
  };
}
