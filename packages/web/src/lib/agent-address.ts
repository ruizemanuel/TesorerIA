import { AGENT_ADDRESS } from "@tesoreria/agent";
import { type Address, isAddressEqual } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { type Env, env } from "./env";

/**
 * The agent every new fund names: AGENT_PRIVATE_KEY's address. On mainnet it must be AGENT_ADDRESS (the
 * registered ERC-8004 agent); anything else stops the server rather than create funds nobody runs.
 */
export function agentAddress(settings: Pick<Env, "AGENT_PRIVATE_KEY" | "CHAIN_MODE"> = env()): Address {
  const { AGENT_PRIVATE_KEY, CHAIN_MODE } = settings;
  if (AGENT_PRIVATE_KEY === undefined) return AGENT_ADDRESS;
  const address = privateKeyToAddress(AGENT_PRIVATE_KEY);
  if (CHAIN_MODE === "mainnet" && !isAddressEqual(address, AGENT_ADDRESS)) {
    throw new Error("AGENT_PRIVATE_KEY is not the key of AGENT_ADDRESS");
  }
  return address;
}
