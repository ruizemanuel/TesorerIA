import {
  type AgentContext,
  type AgentSigner,
  type ChainView,
  FUND_FACTORY_BLOCK,
  type FundSnapshot,
  createAgentSigner,
  createChainView,
} from "@tesoreria/agent";
import { forkSigner } from "@tesoreria/agent/fork";
import { eq } from "drizzle-orm";
import { type Hash, type Hex, http } from "viem";
import { baseClient, celoClient, logReader } from "./chain";
import type { Db } from "./db/client";
import { funds } from "./db/schema";
import { env } from "./env";
import { checkHistory } from "./read-fund";

/** The agent's wallet: CIP-64 with the tag on mainnet; CELO gas on the fork, which can't decode CIP-64. */
export function agentSigner(): AgentSigner {
  const { AGENT_PRIVATE_KEY, CHAIN_MODE, CELO_RPC_URL } = env();
  if (AGENT_PRIVATE_KEY === undefined) throw new Error("AGENT_PRIVATE_KEY is not set");
  const privateKey = AGENT_PRIVATE_KEY as Hex;
  return CHAIN_MODE === "fork" ? forkSigner(privateKey, http(CELO_RPC_URL)) : createAgentSigner({ privateKey, transport: http(CELO_RPC_URL) });
}

/**
 * The agent's context for the web.
 * - It runs only the funds this web created (live in the database and listed by the factory): anyone can create
 *   a fund naming our agent, and that must never cost its gas.
 * - Histories are read from the oldest of those funds' blocks, not the factory's: no fund it runs has an older
 *   event, and on the fork every block scanned is a request through the node.
 * - A history whose reimbursements don't add up to the contract's spentInWeek has a hole (checkHistory): the
 *   agent never decides on it, since a missing Reimbursement would let it pay the same ref twice.
 * - It sends only while AGENT_SEND is "on" (the kill switch); otherwise it decides everything and sends nothing.
 */
export async function agentContext(db: Db, onSent?: AgentContext["onSent"]): Promise<AgentContext> {
  const signer = agentSigner();
  const ours = await db.select({ address: funds.address, createdBlock: funds.createdBlock }).from(funds).where(eq(funds.status, "live"));
  const known = new Set(ours.flatMap((f) => (f.address ? [f.address.toLowerCase()] : [])));
  // A live fund without its block (none should lack it) counts from the factory's.
  const blocks = ours.map((f) => f.createdBlock ?? FUND_FACTORY_BLOCK);
  const fromBlock = blocks.reduce((oldest, block) => (block < oldest ? block : oldest), blocks[0] ?? FUND_FACTORY_BLOCK);
  const view = createChainView({ celo: celoClient(), base: baseClient(), logs: logReader(), agent: signer.address, fromBlock });
  const snapshots = new Map<string, FundSnapshot>();
  const chain: ChainView = {
    ...view,
    funds: async () => (await view.funds()).filter((f) => known.has(f.toLowerCase())),
    fund: async (address) => {
      const snapshot = await view.fund(address);
      snapshots.set(address.toLowerCase(), snapshot);
      return snapshot;
    },
    events: async (address, toBlock) => {
      const events = await view.events(address, toBlock);
      const snapshot = snapshots.get(address.toLowerCase());
      if (snapshot !== undefined && snapshot.block === toBlock) checkHistory(snapshot, events); // throws: "blocked"
      return events;
    },
  };
  return { chain, signer, now: () => BigInt(Math.floor(Date.now() / 1000)), send: env().AGENT_SEND === "on", onSent };
}

/**
 * Whether the agent has a transaction sent and not yet mined: its nonce counting what waits to be mined
 * ("pending") is ahead of the mined one ("latest"). When the node can't tell, it counts as in flight.
 */
export async function agentInFlight(): Promise<boolean> {
  try {
    const { address } = agentSigner();
    const client = celoClient();
    const [pending, latest] = await Promise.all([
      client.getTransactionCount({ address, blockTag: "pending" }),
      client.getTransactionCount({ address, blockTag: "latest" }),
    ]);
    return pending !== latest;
  } catch {
    return true;
  }
}

/** A transaction's receipt without waiting: "pending" while there is none. */
export async function txStatus(hash: Hash): Promise<"success" | "reverted" | "pending"> {
  try {
    return (await celoClient().getTransactionReceipt({ hash })).status;
  } catch {
    return "pending";
  }
}
