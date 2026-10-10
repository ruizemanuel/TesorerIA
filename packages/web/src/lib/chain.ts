import { BLOCKSCOUT_API, type LogReader, RPC_LOG_RANGE, blockscoutLogReader, rpcLogReader } from "@tesoreria/agent";
import { type Chain, type Hash, type PublicClient, type Transport, createPublicClient, getAbiItem, http } from "viem";
import { entryPoint07Abi, entryPoint07Address } from "viem/account-abstraction";
import { base, celo } from "viem/chains";
import { env } from "./env";

// With the chain fixed (not `Chain | undefined`), which is what the wallet package asks of its client.
type ChainClient = PublicClient<Transport, Chain>;

const shared = globalThis as { tesoreriaCelo?: ChainClient; tesoreriaBase?: ChainClient };

/** Celo, through CELO_RPC_URL: forno on mainnet, anvil on the fork. */
export function celoClient(): ChainClient {
  shared.tesoreriaCelo ??= createPublicClient({ chain: celo, transport: http(env().CELO_RPC_URL) }) as ChainClient;
  return shared.tesoreriaCelo;
}

/** Base, for Chainlink's USD / ARS (spec, 8.1). */
export function baseClient(): ChainClient {
  shared.tesoreriaBase ??= createPublicClient({ chain: base, transport: http(env().BASE_RPC_URL) }) as ChainClient;
  return shared.tesoreriaBase;
}

/** A fund's history: Blockscout plus the node on mainnet; on the fork, the node alone (Blockscout doesn't know it). */
export function logReader(): LogReader {
  const rpc = rpcLogReader(celoClient());
  if (env().CHAIN_MODE === "fork") return rpc;
  return blockscoutLogReader({ apiUrl: BLOCKSCOUT_API, rpc, apiKey: env().BLOCKSCOUT_API_KEY });
}

export type LandedOperation = { userOpHash: Hash; transactionHash: Hash; success: boolean };

/** Where the EntryPoint ran one of `userOpHashes`, sent no earlier than `since`, or null if it hasn't. */
export type UserOperationFinder = (query: { userOpHashes: Hash[]; since: Date }) => Promise<LandedOperation | null>;

const userOperationEvent = getAbiItem({ abi: entryPoint07Abi, name: "UserOperationEvent" });
/** Celo makes a block a second: the block an operation was sent in is about this many before the clocks could disagree. */
const CLOCK_MARGIN_BLOCKS = 600n;

/**
 * Finds an operation's UserOperationEvent on the chain itself (its userOpHash is indexed), for when the bundler
 * can't: Pimlico's bundler only looks about 2,000 blocks back. It reads the node RPC_LOG_RANGE blocks at a time,
 * from about the block of `since` (Celo makes one a second) up to the latest, oldest first, and stops at the first.
 */
export function userOperationFinder(client: Pick<PublicClient, "getBlock" | "getLogs">): UserOperationFinder {
  return async ({ userOpHashes, since }) => {
    const latest = await client.getBlock({ blockTag: "latest" });
    const ago = latest.timestamp - BigInt(Math.floor(since.getTime() / 1000));
    const start = latest.number - (ago > 0n ? ago : 0n) - CLOCK_MARGIN_BLOCKS;
    for (let from = start > 0n ? start : 0n; from <= latest.number; from += RPC_LOG_RANGE) {
      const to = from + RPC_LOG_RANGE - 1n < latest.number ? from + RPC_LOG_RANGE - 1n : latest.number;
      const [log] = await client.getLogs({
        address: entryPoint07Address,
        event: userOperationEvent,
        args: { userOpHash: userOpHashes },
        fromBlock: from,
        toBlock: to,
      });
      if (log !== undefined) return { userOpHash: log.args.userOpHash!, transactionHash: log.transactionHash!, success: log.args.success! };
    }
    return null;
  };
}
