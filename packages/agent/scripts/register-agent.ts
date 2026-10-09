// Registers the agent's ERC-8004 identity on Celo mainnet: register(AGENT_URI) on the Identity Registry, sent
// from the agent's wallet with the gas in USDT and the attribution tag.
//
// Usage, from packages/agent:
//   pnpm register:agent          dry run: checks the published file, that the agent has no identity yet, and the cost
//   pnpm register:agent --send   sends the registration (refused if the agent already has one, unless --again)
// Reads AGENT_PRIVATE_KEY, and optionally CELO_RPC_URL (never printed), from packages/agent/.env.local.
import { createPublicClient, erc20Abi, formatUnits, http, isAddressEqual } from "viem";
import { celo } from "viem/chains";
import { IDENTITY_REGISTRY, USDT } from "../src/chain";
import { shortMessage } from "../src/errors";
import { AGENT_URI, agentIdFromLogs, identityRegistryAbi, registerData, registrationFile } from "../src/registration";
import { createAgentSigner } from "../src/signer";
import { agentKey, rpcUrl } from "./env";

async function main(): Promise<number> {
  const send = process.argv.includes("--send");
  const privateKey = agentKey();
  if (privateKey === undefined) {
    console.error("AGENT_PRIVATE_KEY is missing or malformed in packages/agent/.env.local");
    return 64;
  }
  const celoRpc = rpcUrl("CELO_RPC_URL", "https://forno.celo.org");
  const client = createPublicClient({ chain: celo, transport: http(celoRpc.url) });
  const signer = createAgentSigner({ privateKey, transport: http(celoRpc.url) });
  console.log(`Agent: ${signer.address}`);
  console.log(`RPC: ${celoRpc.label}`);
  console.log(`agentURI: ${AGENT_URI}`);

  // The URI goes on chain for good: it must already serve exactly this repo's file.
  const published = await fetch(AGENT_URI, { cache: "no-store" })
    .then((response) => (response.ok ? response.text() : `HTTP ${response.status}`))
    .catch(() => "unreachable");
  if (published !== registrationFile()) {
    console.error(
      "The agentURI doesn't serve this repo's registration.json yet: push it to main, " +
        "and give GitHub's cache up to 5 minutes.",
    );
    return 1;
  }
  console.log("The agentURI serves this repo's registration.json.");

  const owned = await client.readContract({
    address: IDENTITY_REGISTRY,
    abi: identityRegistryAbi,
    functionName: "balanceOf",
    args: [signer.address],
  });
  if (owned > 0n && !process.argv.includes("--again")) {
    console.error(`The agent already holds ${owned} ERC-8004 identity NFT(s). To register another one, add --again.`);
    return 1;
  }

  const balance = await client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [signer.address] });
  // With no USDT, Celo's node can't estimate a transaction that pays its gas in USDT.
  if (balance === 0n) {
    console.error("The agent holds 0 USDT: send USDT on Celo to its address first.");
    return 1;
  }
  const data = registerData();
  const { gas, maxCost } = await signer.estimate({ to: IDENTITY_REGISTRY, data });
  console.log(`Register: ${gas} gas, at most ${formatUnits(maxCost, 18)} USDT. The agent holds ${formatUnits(balance, 6)} USDT.`);
  // The adapter counts USDT with 18 decimals; the token has 6.
  if (balance * 10n ** 12n < maxCost) {
    console.error("Not enough USDT for the gas: send USDT on Celo to the agent's address first.");
    return 1;
  }
  if (!send) {
    console.log("Dry run: nothing was sent. Run again with --send to register.");
    return 0;
  }

  const hash = await signer.send({ to: IDENTITY_REGISTRY, data });
  console.log(`Sent: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`Status: ${receipt.status}, block ${receipt.blockNumber}, ${receipt.gasUsed} gas`);
  if (receipt.status !== "success") return 1;
  const agentId = agentIdFromLogs(receipt.logs);
  const [uri, wallet] = await Promise.all([
    client.readContract({ address: IDENTITY_REGISTRY, abi: identityRegistryAbi, functionName: "tokenURI", args: [agentId] }),
    client.readContract({ address: IDENTITY_REGISTRY, abi: identityRegistryAbi, functionName: "getAgentWallet", args: [agentId] }),
  ]);
  console.log(`Agent id: ${agentId}. tokenURI: ${uri}. Agent wallet: ${wallet}.`);
  if (uri !== AGENT_URI || !isAddressEqual(wallet, signer.address)) {
    console.error("The registry doesn't show what was just registered: check it on a block explorer.");
    return 1;
  }
  console.log(`Next: set AGENT_ID = ${agentId}n in src/registration.ts, run pnpm registration:write, commit and push.`);
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`Failed: ${shortMessage(error)}`);
  return 1;
});
