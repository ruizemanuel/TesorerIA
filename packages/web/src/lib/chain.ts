import { BLOCKSCOUT_API, type LogReader, blockscoutLogReader, rpcLogReader } from "@tesoreria/agent";
import { type Chain, type PublicClient, type Transport, createPublicClient, http } from "viem";
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
