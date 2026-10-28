// Sets the agent's ERC-8004 URI to AGENT_URI again: setAgentURI(AGENT_ID, AGENT_URI) on the Identity Registry, sent
// from the agent's wallet with the gas in USDT and the attribution tag. With the same URI nothing changes on chain,
// but the URIUpdated event tells indexers such as 8004scan to read registration.json again after a commit changed it.
//
// Usage, from packages/agent:
//   pnpm agent-uri:set          dry run: checks the key is the agent's wallet and owns AGENT_ID, the published file,
//                               that there's no pending transaction, and the cost
//   pnpm agent-uri:set --send   sends it
// Run it away from the heartbeat's minutes (2, 17, 32 and 47): the agent's server sends from the same wallet.
// Reads AGENT_PRIVATE_KEY, and optionally CELO_RPC_URL (never printed), from packages/agent/.env.local.
import { createPublicClient, erc20Abi, formatUnits, http, isAddressEqual } from "viem";
import { celo } from "viem/chains";
import { AGENT_ADDRESS, IDENTITY_REGISTRY, USDT } from "../src/chain";
import { shortMessage } from "../src/errors";
import { AGENT_ID, AGENT_URI, identityRegistryAbi, setAgentUriData, uriUpdateFromLogs } from "../src/registration";
import { createAgentSigner } from "../src/signer";
import { agentKey, rpcUrl } from "./env";
import { publishedProblem } from "./published";

async function main(): Promise<number> {
  const send = process.argv.includes("--send");
  if (AGENT_ID === null) {
    console.error("The agent has no ERC-8004 id yet: register it with pnpm register:agent.");
    return 1;
  }
  const privateKey = agentKey();
  if (privateKey === undefined) {
    console.error("AGENT_PRIVATE_KEY is missing or malformed in packages/agent/.env.local");
    return 64;
  }
  const celoRpc = rpcUrl("CELO_RPC_URL", "https://forno.celo.org");
  const client = createPublicClient({ chain: celo, transport: http(celoRpc.url) });
  const signer = createAgentSigner({ privateKey, transport: http(celoRpc.url) });
  if (!isAddressEqual(signer.address, AGENT_ADDRESS)) {
    console.error(`AGENT_PRIVATE_KEY is not the agent's wallet (${AGENT_ADDRESS}), which the registration file names.`);
    return 1;
  }
  console.log(`Agent: ${signer.address}, agent id ${AGENT_ID}`);
  console.log(`RPC: ${celoRpc.label}`);

  // Indexers read the file when they see the event: it must already be the one in this repo.
  const problem = await publishedProblem();
  if (problem !== undefined) {
    console.error(problem);
    return 1;
  }
  console.log("The agentURI serves this repo's registration.json.");

  const [owner, current] = await Promise.all([
    client.readContract({ address: IDENTITY_REGISTRY, abi: identityRegistryAbi, functionName: "ownerOf", args: [AGENT_ID] }),
    client.readContract({ address: IDENTITY_REGISTRY, abi: identityRegistryAbi, functionName: "tokenURI", args: [AGENT_ID] }),
  ]);
  if (!isAddressEqual(owner, signer.address)) {
    console.error(`Agent id ${AGENT_ID} belongs to ${owner}, not to the agent's wallet.`);
    return 1;
  }
  console.log(`tokenURI now: ${current}`);
  console.log(`tokenURI after: ${AGENT_URI}${current === AGENT_URI ? " (the same)" : ""}`);

  // The agent's server sends from this wallet too: with a transaction of its in flight, this one could take its nonce.
  const [pendingNonce, minedNonce] = await Promise.all([
    client.getTransactionCount({ address: signer.address, blockTag: "pending" }),
    client.getTransactionCount({ address: signer.address, blockTag: "latest" }),
  ]);
  if (pendingNonce > minedNonce) {
    console.error("The agent has a pending transaction: wait until it's mined or dropped, then run this again.");
    return 1;
  }

  const balance = await client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [signer.address] });
  // With no USDT, Celo's node can't estimate a transaction that pays its gas in USDT.
  if (balance === 0n) {
    console.error("The agent holds 0 USDT: send USDT on Celo to its address first.");
    return 1;
  }
  const data = setAgentUriData(AGENT_ID);
  const { gas, maxCost } = await signer.estimate({ to: IDENTITY_REGISTRY, data });
  console.log(`setAgentURI: ${gas} gas, at most ${formatUnits(maxCost, 18)} USDT. The agent holds ${formatUnits(balance, 6)} USDT.`);
  // The adapter counts USDT with 18 decimals; the token has 6.
  if (balance * 10n ** 12n < maxCost) {
    console.error("Not enough USDT for the gas: send USDT on Celo to the agent's address first.");
    return 1;
  }
  if (!send) {
    console.log("Dry run: nothing was sent. Run again with --send to set it.");
    return 0;
  }

  const hash = await signer.send({ to: IDENTITY_REGISTRY, data });
  console.log(`Sent: ${hash}`);
  let receipt: Awaited<ReturnType<typeof client.waitForTransactionReceipt>>;
  try {
    receipt = await client.waitForTransactionReceipt({ hash });
  } catch (error) {
    console.error(`Failed: ${shortMessage(error)}`);
    console.error(`Do not run --send again until ${hash} is mined or dropped: check it on a block explorer.`);
    return 1;
  }
  console.log(`Status: ${receipt.status}, block ${receipt.blockNumber}, ${receipt.gasUsed} gas`);
  if (receipt.status !== "success") return 1;
  // The registry's event is the proof. tokenURI reads the same before and after it, and reading it at the receipt's
  // block fails on a forno node that doesn't have that block yet (-32019, 28/10).
  const update = uriUpdateFromLogs(receipt.logs);
  console.log(`URIUpdated: agent id ${update.agentId}, ${update.newURI}, by ${update.updatedBy}.`);
  if (update.agentId !== AGENT_ID || update.newURI !== AGENT_URI) {
    console.error(`The registry doesn't show what was just set: check ${hash} on a block explorer.`);
    return 1;
  }
  console.log(`Next: pnpm --filter @tesoreria/wallet verify ${hash}`);
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`Failed: ${shortMessage(error)}`);
  return 1;
});
