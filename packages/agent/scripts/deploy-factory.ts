// Deploys FundFactory to Celo mainnet from the agent's wallet: gas paid in USDT, ERC-8021 attribution suffix.
//
// Usage, from packages/agent, after `forge build` in contracts/:
//   pnpm deploy:factory          dry run: checks the pool and estimates the cost; sends nothing
//   pnpm deploy:factory --send   sends the deploy transaction (refused if the agent already sent one, unless --again)
// Reads AGENT_PRIVATE_KEY, and optionally CELO_RPC_URL (never printed), from packages/agent/.env.local.
import { readFileSync } from "node:fs";
import { BaseError, createPublicClient, erc20Abi, formatUnits, http, isHex } from "viem";
import { celo } from "viem/chains";
import { POOL, USDT } from "../src/chain";
import { type FactoryArtifact, checkPool, factoryDeployData } from "../src/deploy";
import { createAgentSigner } from "../src/signer";

const ARTIFACT = new URL("../../../contracts/out/FundFactory.sol/FundFactory.json", import.meta.url);

async function main(): Promise<number> {
  const send = process.argv.includes("--send");
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (privateKey === undefined || !isHex(privateKey) || privateKey.length !== 66) {
    console.error("AGENT_PRIVATE_KEY is missing or malformed in packages/agent/.env.local");
    return 64;
  }
  const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: celo, transport });
  const agent = createAgentSigner({ privateKey, transport });
  console.log(`Agent: ${agent.address}`);
  // A custom endpoint usually carries an API key in its path or query: never print it.
  console.log(process.env.CELO_RPC_URL === undefined ? `RPC: ${rpcUrl}` : "RPC: custom endpoint from CELO_RPC_URL");

  const { cardinality, cardinalityNext } = await checkPool(publicClient);
  console.log(
    `Pool ${POOL}: official getPool(wARS, USDT, 100), 30-minute TWAP OK, ` +
      `observation cardinality ${cardinality} (next ${cardinalityNext})`,
  );

  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as FactoryArtifact;
  const data = factoryDeployData(artifact);
  const { gas, maxCost } = await agent.estimate({ data });
  const balance = await publicClient.readContract({
    address: USDT,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [agent.address],
  });
  console.log(
    `Deploy: ${gas} gas, at most ${formatUnits(maxCost, 18)} USDT. ` +
      `The agent holds ${formatUnits(balance, 6)} USDT.`,
  );
  // The adapter counts USDT with 18 decimals; the token has 6.
  if (balance * 10n ** 12n < maxCost) {
    console.error("Not enough USDT for the gas: send USDT on Celo to the agent's address first.");
    return 1;
  }
  if (!send) {
    console.log("Dry run: nothing was sent. Run again with --send to deploy.");
    return 0;
  }
  const nonce = await publicClient.getTransactionCount({ address: agent.address });
  if (nonce > 0 && !process.argv.includes("--again")) {
    console.error(`The agent already sent ${nonce} transaction(s). If you really want another factory, add --again.`);
    return 1;
  }

  const hash = await agent.send({ data });
  console.log(`Sent: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Status: ${receipt.status}, block ${receipt.blockNumber}, ${receipt.gasUsed} gas`);
  if (receipt.status !== "success" || !receipt.contractAddress) return 1;
  console.log(`FundFactory: ${receipt.contractAddress}`);
  return 0;
}

// viem's long messages and causes can include the RPC URL: print only the short message.
process.exitCode = await main().catch((error: unknown) => {
  const message = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error);
  console.error(`Failed: ${message}`);
  return 1;
});
