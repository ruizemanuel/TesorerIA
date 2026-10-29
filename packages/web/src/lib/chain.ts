import { BLOCKSCOUT_API, BLOCKSCOUT_PRO_API, type LogReader, RPC_LOG_RANGE, blockscoutLogReader, rpcLogReader } from "@tesoreria/agent";
import { BaseError, type Chain, type Hash, type PublicClient, type Transport, createPublicClient, getAbiItem, http } from "viem";
import { entryPoint07Abi, entryPoint07Address } from "viem/account-abstraction";
import { base, celo } from "viem/chains";
import { env } from "./env";

// With the chain fixed (not `Chain | undefined`), which is what the wallet package asks of its client.
type ChainClient = PublicClient<Transport, Chain>;

const shared = globalThis as { tesoreriaCelo?: ChainClient; tesoreriaBase?: ChainClient };

/** Celo, through CELO_RPC_URL: forno on mainnet, anvil on the fork. */
export function celoClient(): ChainClient {
  shared.tesoreriaCelo ??= createPublicClient({ chain: celo, transport: retryingBlockOutOfRange(http(env().CELO_RPC_URL)) }) as ChainClient;
  return shared.tesoreriaCelo;
}

/**
 * Celo, through CELO_RPC_URL, for one read that answers within `timeoutMs` or fails, without viem's own retries
 * (three more, of up to 10 s each): for a read made while a person waits, which their next tap tries again.
 */
export function quickCeloClient(timeoutMs: number): ChainClient {
  return createPublicClient({ chain: celo, transport: http(env().CELO_RPC_URL, { timeout: timeoutMs, retryCount: 0 }) }) as ChainClient;
}

/** Forno's answer to a request at a block the node that took it doesn't have yet: "block is out of range". */
export const BLOCK_OUT_OF_RANGE = -32019;

/** A request for a block by its number, not by a tag like "latest": a node that answers it with null doesn't have it yet. */
function blockByNumber({ method, params }: { method: string; params?: unknown }): boolean {
  return method === "eth_getBlockByNumber" && Array.isArray(params) && typeof params[0] === "string" && params[0].startsWith("0x");
}

/**
 * `transport`, but a request at a block the node doesn't have yet is asked again, up to `retries` times, `delayMs`
 * apart. Forno spreads requests over nodes, and a read at the block one of them just gave as the latest can reach
 * another that is a block behind (21/10: 4 reads in 40, each readable again within 400 ms). A fund's screen and the
 * agent's heartbeat read the whole fund at one block, so one such answer failed them all. The node says so in two
 * ways: a call answers BLOCK_OUT_OF_RANGE, and a block asked for by its number comes back null, which viem turns into
 * "Block at number … could not be found" (29/10: the portada lost its fund to it). viem asks again only on a few codes
 * of its own, and neither is one of them. A block that still isn't there after the retries comes back null as it did.
 */
export function retryingBlockOutOfRange(transport: Transport, { retries = 3, delayMs = 500 }: { retries?: number; delayMs?: number } = {}): Transport {
  return (config) => {
    const inner = transport(config);
    type Request = typeof inner.request;
    const request = async (args: Parameters<Request>[0], options?: Parameters<Request>[1]): Promise<unknown> => {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await inner.request(args, options);
          const notThereYet = result === null && blockByNumber(args);
          if (!notThereYet || attempt >= retries) return result;
        } catch (error) {
          const outOfRange = error instanceof BaseError && error.walk((e) => (e as { code?: unknown }).code === BLOCK_OUT_OF_RANGE) !== null;
          if (!outOfRange || attempt >= retries) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    };
    // It answers whatever `inner` answered, so it keeps inner's typing: kept in a variable, the answer is only unknown.
    return { ...inner, request: request as Request };
  };
}

/** Base, for Chainlink's USD / ARS (spec, 8.1). */
export function baseClient(): ChainClient {
  shared.tesoreriaBase ??= createPublicClient({ chain: base, transport: http(env().BASE_RPC_URL) }) as ChainClient;
  return shared.tesoreriaBase;
}

/** About a day of Celo's one-second blocks: at most 20 of the node's 5,000-block requests. */
export const NODE_FALLBACK_BLOCKS = 20n * RPC_LOG_RANGE;

/**
 * `primary`, but a history of at most `maxBlocks` that it fails to read comes from `node` instead: a young fund's page
 * and heartbeat don't stop when Blockscout does (the real fund's page did, on 11/10, on its 429s). A longer history
 * still needs `primary`, and its failure still throws.
 */
export function withNodeFallback(primary: LogReader, node: LogReader, maxBlocks = NODE_FALLBACK_BLOCKS): LogReader {
  return async (query) => {
    try {
      return await primary(query);
    } catch (error) {
      if (query.toBlock - query.fromBlock + 1n > maxBlocks) throw error;
      console.warn(`Blockscout failed (${error instanceof Error ? error.message : String(error)}): reading the history from the node`);
      return node(query);
    }
  };
}

/**
 * A fund's history: Blockscout plus the node on mainnet, through the PRO API when there's a key (see
 * BLOCKSCOUT_PRO_API), and from the node alone when Blockscout fails on a short one; on the fork, the node alone
 * (Blockscout doesn't know it).
 */
export function logReader(): LogReader {
  const rpc = rpcLogReader(celoClient());
  if (env().CHAIN_MODE === "fork") return rpc;
  const apiKey = env().BLOCKSCOUT_API_KEY;
  return withNodeFallback(blockscoutLogReader({ apiUrl: apiKey === undefined ? BLOCKSCOUT_API : BLOCKSCOUT_PRO_API, rpc, apiKey }), rpc);
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
