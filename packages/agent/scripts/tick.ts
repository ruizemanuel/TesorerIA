// One heartbeat of the agent on Celo mainnet: converts the USDT waiting in the funds it runs.
//
// Usage, from packages/agent:
//   pnpm agent:tick          dry run: reads, decides and estimates; sends nothing
//   pnpm agent:tick --send   also sends what it decides
// Reads AGENT_PRIVATE_KEY, and optionally CELO_RPC_URL and BASE_RPC_URL (never printed), from packages/agent/.env.local.
import { createPublicClient, formatUnits, http } from "viem";
import { base, celo } from "viem/chains";
import { BLOCKSCOUT_API } from "../src/chain";
import { shortMessage } from "../src/errors";
import { blockscoutLogReader, rpcLogReader } from "../src/events";
import { runHeartbeat } from "../src/run";
import { createAgentSigner } from "../src/signer";
import { createChainView } from "../src/view";
import { agentKey, rpcUrl } from "./env";

function unixNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

async function main(): Promise<number> {
  const send = process.argv.includes("--send");
  const privateKey = agentKey();
  if (privateKey === undefined) {
    console.error("AGENT_PRIVATE_KEY is missing or malformed in packages/agent/.env.local");
    return 64;
  }
  const celoRpc = rpcUrl("CELO_RPC_URL", "https://forno.celo.org");
  const baseRpc = rpcUrl("BASE_RPC_URL", "https://mainnet.base.org");
  const celoClient = createPublicClient({ chain: celo, transport: http(celoRpc.url) });
  const baseClient = createPublicClient({ chain: base, transport: http(baseRpc.url) });
  const signer = createAgentSigner({ privateKey, transport: http(celoRpc.url) });
  console.log(`Agent: ${signer.address}`);
  console.log(`RPC: Celo ${celoRpc.label}; Base ${baseRpc.label}`);

  const chain = createChainView({
    celo: celoClient,
    base: baseClient,
    logs: blockscoutLogReader({ apiUrl: BLOCKSCOUT_API, rpc: rpcLogReader(celoClient) }),
    agent: signer.address,
  });
  const { usdArs, usdtUsd } = await chain.references();
  const age = (updatedAt: bigint) => `${(Number(unixNow() - updatedAt) / 3_600).toFixed(1)} h old`;
  console.log(
    `Chainlink: USD / ARS ${formatUnits(usdArs.answer, usdArs.decimals)} (${age(usdArs.updatedAt)}), ` +
      `USDT / USD ${formatUnits(usdtUsd.answer, usdtUsd.decimals)} (${age(usdtUsd.updatedAt)})`,
  );
  console.log(`The agent holds ${formatUnits(await chain.gasBalance(), 6)} USDT for gas.`);
  console.log(`FundFactory has created ${(await chain.funds()).length} fund(s).`);

  const decisions = await runHeartbeat({ chain, signer, now: unixNow, send });
  for (const { fund, kind, reason, tx, status } of decisions) {
    console.log(`${fund ?? "agent"} ${kind}: ${reason}${tx === undefined ? "" : ` (${tx}, ${status})`}`);
  }
  if (decisions.length === 0) console.log("Nothing to do.");
  if (!send) console.log("Dry run: nothing was sent. Run again with --send to act.");
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`Failed: ${shortMessage(error)}`);
  return 1;
});
