// Registers the agent's ERC-8004 identity on Celo mainnet: register(AGENT_URI) on the Identity Registry, sent
// from the agent's wallet with the gas in USDT and the attribution tag.
//
// Usage, from packages/agent:
//   pnpm register:agent          dry run: checks the key is the agent's wallet, the published file, that the agent has
//                                no identity yet and no pending transaction, and the cost
//   pnpm register:agent --send   sends the registration (refused if the agent already has one, unless --again)
// Reads AGENT_PRIVATE_KEY, and optionally CELO_RPC_URL (never printed), from packages/agent/.env.local.
import { createPublicClient, erc20Abi, formatUnits, http, isAddressEqual } from "viem";
import { celo } from "viem/chains";
import { AGENT_ADDRESS, IDENTITY_REGISTRY, USDT } from "../src/chain";
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
  // The registration file names AGENT_ADDRESS as the agent's wallet: no other key may register it.
  if (!isAddressEqual(signer.address, AGENT_ADDRESS)) {
    console.error(`AGENT_PRIVATE_KEY is not the agent's wallet (${AGENT_ADDRESS}), which the registration file names.`);
    return 1;
  }
  console.log(`Agent: ${signer.address}`);
  console.log(`RPC: ${celoRpc.label}`);
  console.log(`agentURI: ${AGENT_URI}`);

  // The URI goes on chain for good: it must already serve exactly this repo's file.
  const published = await fetch(AGENT_URI, { cache: "no-store" })
    .then(async (response) =>
      response.ok ? { text: await response.text() } : { problem: `The agentURI answered HTTP ${response.status}.` },
    )
    .catch((error: unknown) => ({ problem: `The agentURI is unreachable: ${shortMessage(error)}.` }));
  if ("problem" in published) {
    console.error(published.problem);
    return 1;
  }
  if (published.text !== registrationFile()) {
    console.error(
      "The agentURI serves a file whose content differs from this repo's registration.json: push it to main, " +
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
  // A registration that was sent and isn't mined yet doesn't show in balanceOf: sending again would register twice.
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

  // From here on the registration may be on chain: every failure says so and says not to send again.
  let mined = false;
  let agentId: bigint | undefined;
  try {
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`Status: ${receipt.status}, block ${receipt.blockNumber}, ${receipt.gasUsed} gas`);
    if (receipt.status !== "success") return 1;
    mined = true;
    agentId = agentIdFromLogs(receipt.logs);
    console.log(`Agent id: ${agentId}`);
    // Read at the receipt's block: a node that is still behind it fails instead of answering with older state.
    const [uri, wallet] = await Promise.all([
      client.readContract({
        address: IDENTITY_REGISTRY,
        abi: identityRegistryAbi,
        functionName: "tokenURI",
        args: [agentId],
        blockNumber: receipt.blockNumber,
      }),
      client.readContract({
        address: IDENTITY_REGISTRY,
        abi: identityRegistryAbi,
        functionName: "getAgentWallet",
        args: [agentId],
        blockNumber: receipt.blockNumber,
      }),
    ]);
    console.log(`tokenURI: ${uri}. Agent wallet: ${wallet}.`);
    if (uri !== AGENT_URI || !isAddressEqual(wallet, AGENT_ADDRESS)) {
      console.error(
        `The registry doesn't show what was just registered: check ${hash} on a block explorer. Do not run --send again.`,
      );
      return 1;
    }
  } catch (error) {
    console.error(`Failed: ${shortMessage(error)}`);
    if (agentId !== undefined) {
      console.error(`Registered as agent id ${agentId} in ${hash}; check it on a block explorer. Do not run --send again.`);
    } else if (mined) {
      console.error(`${hash} succeeded but its receipt has no agent id: check it on a block explorer. Do not run --send again.`);
    } else {
      console.error(`Do not run --send again until ${hash} is mined or dropped: check it on a block explorer.`);
    }
    return 1;
  }
  console.log(`Next: set AGENT_ID = ${agentId}n in src/registration.ts, run pnpm registration:write, commit and push.`);
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`Failed: ${shortMessage(error)}`);
  return 1;
});
