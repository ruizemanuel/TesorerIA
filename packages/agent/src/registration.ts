import { type Hex, type Log, encodeFunctionData, formatUnits, isAddressEqual, parseAbi, parseEventLogs } from "viem";
import { AGENT_ADDRESS, CELO_CHAIN_ID, FUND_FACTORY, IDENTITY_REGISTRY } from "./chain";
import { LIMITS } from "./limits";

export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

/** Where the registration file is served: this repo's copy on GitHub. */
export const AGENT_URI = "https://raw.githubusercontent.com/ruizemanuel/TesorerIA/main/packages/agent/registration.json";

/** The agent's ERC-8004 id on Celo, once registered. */
export const AGENT_ID: bigint | null = null;

function amount(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toLocaleString("en-US");
}

/** The ERC-8004 registration file (registration-v1): who the agent is, what it does and its limits. */
export function agentRegistration() {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "TesorerIA",
    description:
      "TesorerIA runs a group's shared fund in Argentine pesos (wARS) on Celo. Members contribute wARS or USDT; " +
      "the agent converts the USDT to wARS on Uniswap, pays members back for the expense the group agreed on, " +
      "up to a weekly cap, and turns every other payment into a proposal the members vote on. A contract " +
      `deployed by FundFactory ${FUND_FACTORY} enforces its limits: it can only pay members, never above the ` +
      "weekly cap, and it can't change the rules. Its own code adds more: at most " +
      `${amount(LIMITS.maxReimbursementWars, 18)} wARS per reimbursement and ` +
      `${amount(LIMITS.maxDailyReimbursedWars, 18)} wARS a day per fund, ` +
      `${amount(LIMITS.maxConversionUsdt, 6)} USDT per conversion and ` +
      `${amount(LIMITS.maxDailyConvertedUsdt, 6)} USDT a day, and ${LIMITS.maxDailyTransactions} transactions a ` +
      `day per fund. Its wallet, ${AGENT_ADDRESS}, pays gas in USDT and tags every transaction with ` +
      "celo_fbe4d00a2cb4.",
    services: [{ name: "web", endpoint: "https://github.com/ruizemanuel/TesorerIA" }],
    x402Support: false,
    active: true,
    registrations:
      AGENT_ID === null
        ? []
        : [{ agentId: Number(AGENT_ID), agentRegistry: `eip155:${CELO_CHAIN_ID}:${IDENTITY_REGISTRY}` }],
  };
}

/** packages/agent/registration.json, as `pnpm registration:write` writes it and AGENT_URI must serve it. */
export function registrationFile(): string {
  return `${JSON.stringify(agentRegistration(), null, 2)}\n`;
}

/** `register(AGENT_URI)` on the Identity Registry. */
export function registerData(): Hex {
  return encodeFunctionData({ abi: identityRegistryAbi, functionName: "register", args: [AGENT_URI] });
}

/** The agent id that a registration's receipt logs, from the Identity Registry's `Registered` event. */
export function agentIdFromLogs(logs: Log[]): bigint {
  const registered = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs }).find((log) =>
    isAddressEqual(log.address, IDENTITY_REGISTRY),
  );
  if (registered === undefined) throw new Error("The receipt has no Registered event from the Identity Registry");
  return registered.args.agentId;
}
