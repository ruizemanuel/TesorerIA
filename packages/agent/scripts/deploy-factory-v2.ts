// Deploys FundFactoryV2 to Celo mainnet from the agent's wallet: gas paid in USDT, ERC-8021 attribution suffix.
//
// Usage, from packages/agent, after `forge build` in contracts/:
//   pnpm deploy:factory-v2                                dry run: checks the fee recipient and each dollar pool,
//                                                         estimates the cost, prints the agent's nonce and the
//                                                         contract's address; sends nothing
//   pnpm deploy:factory-v2 --send --expect-nonce <n>      sends the deploy transaction as the agent's nonce n, the
//                                                         one the dry run printed (refused if that nonce moved, if
//                                                         the agent has a transaction in flight, or if FACTORIES
//                                                         already lists a version 2, unless --again, or if the
//                                                         build's runtime size isn't the one that was reviewed)
// Reads AGENT_PRIVATE_KEY, and optionally CELO_RPC_URL (never printed), from packages/agent/.env.local.
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  BaseError,
  type Hex,
  type PublicClient,
  createPublicClient,
  erc20Abi,
  formatUnits,
  getContractAddress,
  http,
  isAddressEqual,
  isHex,
  size,
} from "viem";
import { celo } from "viem/chains";
import { FACTORIES, FEE_RECIPIENT, UNISWAP_V3_FACTORY, USDT } from "../src/chain";
import { CURRENCIES } from "../src/currencies";
import {
  type FactoryArtifact,
  checkDollarPool,
  checkFactoryV2,
  checkFactoryV2Send,
  factoryV2DeployData,
} from "../src/deploy";
import { createAgentSigner } from "../src/signer";

const ARTIFACT = new URL("../../../contracts/out/FundFactoryV2.sol/FundFactoryV2.json", import.meta.url);
/** What `forge build --force` gave on 2026-11-17, and EIP-170's limit. The dry run prints both; `--send` needs the first. */
const EXPECTED_RUNTIME_SIZE = 22_514;
const MAX_RUNTIME_SIZE = 24_576;
const READ_BACK_ATTEMPTS = 5;
const READ_BACK_WAIT_MS = 2_000;

/** The value after `--expect-nonce`, as a whole number; undefined when the flag is not there. */
function expectNonceFrom(argv: readonly string[]): number | undefined {
  const at = argv.indexOf("--expect-nonce");
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (value === undefined || !/^\d+$/.test(value)) throw new Error("--expect-nonce needs a whole number");
  return Number(value);
}

async function main(): Promise<number> {
  const send = process.argv.includes("--send");
  const again = process.argv.includes("--again");
  const expectNonce = expectNonceFrom(process.argv);
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (privateKey === undefined || !isHex(privateKey) || privateKey.length !== 66) {
    console.error("AGENT_PRIVATE_KEY is missing or malformed in packages/agent/.env.local");
    return 64;
  }
  const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
  const transport = http(rpcUrl);
  // Celo's own block type is richer than the plain `PublicClient` that `checkDollarPool` asks of its reader.
  const publicClient = createPublicClient({ chain: celo, transport }) as PublicClient;
  const agent = createAgentSigner({ privateKey, transport });
  console.log(`Agent: ${agent.address}`);
  // A custom endpoint usually carries an API key in its path or query: never print it.
  console.log(process.env.CELO_RPC_URL === undefined ? `RPC: ${rpcUrl}` : "RPC: custom endpoint from CELO_RPC_URL");

  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as FactoryArtifact & { deployedBytecode: { object: Hex } };
  const runtimeSize = size(artifact.deployedBytecode.object);
  console.log(
    `FundFactoryV2 runtime: ${runtimeSize} bytes (expected ${EXPECTED_RUNTIME_SIZE}, limit ${MAX_RUNTIME_SIZE})`,
  );
  // A rebuild between the dry run and the send must not deploy bytecode nobody reviewed.
  if (send && runtimeSize !== EXPECTED_RUNTIME_SIZE) {
    console.error(
      `The artifact's runtime is ${runtimeSize} bytes, not the ${EXPECTED_RUNTIME_SIZE} that was reviewed: refusing to send.`,
    );
    return 1;
  }
  const data = factoryV2DeployData(artifact);
  console.log(`Constructor: uniswapFactory ${UNISWAP_V3_FACTORY}, feeRecipient ${FEE_RECIPIENT}`);

  // The fee goes to an account TesorerIA controls, not to a contract that could be anything: no code there.
  const feeRecipientCode = await publicClient.getCode({ address: FEE_RECIPIENT });
  if (feeRecipientCode !== undefined && feeRecipientCode !== "0x") {
    console.error(`The fee recipient ${FEE_RECIPIENT} has code: it should be an account without any.`);
    return 1;
  }
  console.log(`Fee recipient ${FEE_RECIPIENT}: no code, an account`);

  for (const currency of CURRENCIES) {
    if (currency.dollar === null) continue;
    const { cardinality, oldestAge } = await checkDollarPool(publicClient, currency);
    console.log(
      `Pool ${currency.dollar.pool} (${currency.symbol}): official getPool at fee ${currency.dollar.poolFee}, ` +
        `30-minute TWAP OK, observation cardinality ${cardinality}, ` +
        `oldest observation ${oldestAge} seconds old (${(Number(oldestAge) / 3_600).toFixed(1)} hours)`,
    );
  }

  const balance = await publicClient.readContract({
    address: USDT,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [agent.address],
  });
  // Celo nodes refuse to estimate with fee caps for a sender that can't pay any gas, so don't try.
  if (balance === 0n) {
    console.log("The agent holds 0 USDT.");
    console.error("Not enough USDT for the gas: send USDT on Celo to the agent's address first.");
    return 1;
  }
  const { gas, maxCost } = await agent.estimate({ data });
  console.log(
    `Deploy: ${gas} gas, at most ${formatUnits(maxCost, 18)} USDT. ` +
      `The agent holds ${formatUnits(balance, 6)} USDT.`,
  );
  // The adapter counts USDT with 18 decimals; the token has 6.
  if (balance * 10n ** 12n < maxCost) {
    console.error("Not enough USDT for the gas: send USDT on Celo to the agent's address first.");
    return 1;
  }

  // "pending", like the nonce `send` signs with: a transaction that was broadcast but not yet mined still counts.
  const [pendingNonce, latestNonce] = await Promise.all([
    publicClient.getTransactionCount({ address: agent.address, blockTag: "pending" }),
    publicClient.getTransactionCount({ address: agent.address, blockTag: "latest" }),
  ]);
  const expectedAddress = getContractAddress({ from: agent.address, nonce: BigInt(pendingNonce) });
  console.log(`Pending nonce: ${pendingNonce}`);
  if (pendingNonce !== latestNonce) {
    console.log(`The agent has a transaction in flight: its latest nonce is ${latestNonce}.`);
  }
  console.log(`FundFactoryV2 will be at ${expectedAddress}`);
  if (!send) {
    console.log(
      `Dry run: nothing was sent. To deploy, run again with --send --expect-nonce ${pendingNonce}.`,
    );
    return 0;
  }
  checkFactoryV2Send({ expectNonce, pendingNonce, latestNonce, factories: FACTORIES, again });

  // Signed with the nonce the user approved, not with whatever is pending by now: a heartbeat transaction from the same
  // key landing after the guard would otherwise deploy at an address nobody approved.
  const hash = await agent.send({ data, nonce: pendingNonce });
  console.log(`Sent: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Status: ${receipt.status}, block ${receipt.blockNumber}, ${receipt.gasUsed} gas`);
  if (receipt.status !== "success") return 1;
  if (!receipt.contractAddress) {
    console.error("Not a contract creation, or it was replaced: no contract was deployed");
    return 1;
  }
  console.log(`FundFactoryV2: ${receipt.contractAddress}`);
  console.log(`Block: ${receipt.blockNumber}`);
  if (!isAddressEqual(receipt.contractAddress, expectedAddress)) {
    console.error(`The contract is not at the address the dry run expected (${expectedAddress}).`);
    return 1;
  }
  // The RPC may answer from a node that is a block behind the one that gave the receipt, and then the read fails
  // ("returned no data", or the block is out of range): try again a few times. A mismatch is not a read failure.
  for (let attempt = 1; ; attempt++) {
    try {
      await checkFactoryV2(publicClient, receipt.contractAddress, receipt.blockNumber);
      break;
    } catch (error) {
      if (!(error instanceof BaseError) || attempt === READ_BACK_ATTEMPTS) throw error;
      await sleep(READ_BACK_WAIT_MS);
    }
  }
  console.log("Read back: uniswapFactory() and feeRecipient() are the expected ones, fundCount() is 0");
  return 0;
}

// viem's long messages and causes can include the RPC URL: print only the short message.
process.exitCode = await main().catch((error: unknown) => {
  const message = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error);
  console.error(`Failed: ${message}`);
  return 1;
});
