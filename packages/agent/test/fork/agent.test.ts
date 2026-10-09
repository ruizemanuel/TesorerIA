import { ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
import {
  type Address,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { beforeAll, describe, expect, it } from "vitest";
import { fundFactoryAbi } from "../../src/abi";
import { FUND_FACTORY, POOL, USDT, WARS } from "../../src/chain";
import { rpcLogReader } from "../../src/events";
import { type ContractReader, quoteConversion, readReferences } from "../../src/market";
import { type AgentContext, handleExpense, runHeartbeat } from "../../src/run";
import { createChainView } from "../../src/view";
import { ANVIL_RPC_URL } from "../support/anvil.globalSetup";
import { ref } from "../support/fixtures";
import { forkSigner } from "../support/forkSigner";

const transport = http(ANVIL_RPC_URL);
const publicClient = createPublicClient({ chain: celo, transport });
const testClient = createTestClient({ chain: celo, mode: "anvil", transport });
const walletClient = createWalletClient({ chain: celo, transport });

const agentKey = generatePrivateKey();
const members = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()].map((key) => privateKeyToAccount(key));
const [ana, beto] = members as [(typeof members)[number], (typeof members)[number]];
const WEEKLY_CAP = parseUnits("60000", 18);
// What members call; the agent's own ABI leaves it out.
const memberAbi = parseAbi([
  "function contributeUsdt(uint256 amount)",
  "function contributeWars(uint256 amount)",
  "function getProposal(uint256 id) view returns ((uint8 action, address a, address b, uint256 amount, uint64 deadline, bool executed, address proposer, string note))",
]);

let fund: Address;
let ctx: AgentContext;

async function send(from: (typeof members)[number], to: Address, data: Hex) {
  const hash = await walletClient.sendTransaction({ account: from, to, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  return receipt;
}

/** The pool holds plenty of both tokens: hand some out by impersonating it. */
async function giveFromPool(token: Address, to: Address, amount: bigint) {
  await testClient.impersonateAccount({ address: POOL });
  const hash = await walletClient.sendTransaction({
    account: POOL,
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await testClient.stopImpersonatingAccount({ address: POOL });
}

function wars(address: Address) {
  return publicClient.readContract({ address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

/**
 * Chainlink's USD / ARS lives on Base, which the fork doesn't have: a stand-in that agrees with the forked
 * pool's price and was updated just now. USDT / USD is the real feed on the fork.
 */
async function baseAgreeingWithThePool(): Promise<ContractReader> {
  const answering = (answer: bigint, updatedAt: bigint) =>
    ({
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "decimals" ? 8 : [1n, answer, updatedAt, updatedAt, 1n],
    }) as unknown as ContractReader;
  const { usdtUsd } = await readReferences({ base: answering(1n, 0n), celo: publicClient });
  const { quotedWars } = await quoteConversion(publicClient, fund, 1_000_000n);
  // For 1 USDT, Chainlink's wARS are 100 × usdArs × usdtUsd (8 decimals each): pick usdArs to match the pool.
  return answering(quotedWars / (100n * usdtUsd.answer), BigInt(Math.floor(Date.now() / 1000)));
}

beforeAll(async () => {
  const agent = privateKeyToAccount(agentKey).address;
  for (const address of [agent, POOL, ...members.map((m) => m.address)]) {
    await testClient.setBalance({ address, value: parseEther("10") });
  }
  await giveFromPool(USDT, agent, parseUnits("1", 6)); // the agent's gas money (unused on the fork, but checked)
  await giveFromPool(USDT, ana.address, parseUnits("50", 6));
  await giveFromPool(WARS, beto.address, parseUnits("100000", 18));

  const fromBlock = await publicClient.getBlockNumber();
  const created = await send(
    ana,
    FUND_FACTORY,
    encodeFunctionData({
      abi: fundFactoryAbi,
      functionName: "createFund",
      args: [
        {
          name: "Fork",
          members: members.map((m) => m.address),
          votesRequired: 2,
          agent,
          agreedExpense: "Pitch",
          weeklyCap: WEEKLY_CAP,
          balanceCap: parseUnits("450000", 18),
        },
      ],
    }),
  );
  const [event] = parseEventLogs({ abi: fundFactoryAbi, eventName: "FundCreated", logs: created.logs });
  if (event === undefined) throw new Error("no FundCreated");
  fund = event.args.fund;

  const approve = (amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [fund, amount] });
  await send(ana, USDT, approve(parseUnits("50", 6)));
  await send(ana, fund, encodeFunctionData({ abi: memberAbi, functionName: "contributeUsdt", args: [parseUnits("50", 6)] }));
  await send(beto, WARS, approve(parseUnits("100000", 18)));
  await send(beto, fund, encodeFunctionData({ abi: memberAbi, functionName: "contributeWars", args: [parseUnits("100000", 18)] }));

  const chain = createChainView({
    celo: publicClient,
    base: await baseAgreeingWithThePool(),
    logs: rpcLogReader(publicClient),
    agent,
    fromBlock,
  });
  ctx = { chain, signer: forkSigner(agentKey, transport), now: () => BigInt(Math.floor(Date.now() / 1000)), send: true };
});

describe("the agent against a fork of Celo mainnet, with the deployed FundFactory", () => {
  it("converts the fund's USDT in the real pool, with the attribution suffix", async () => {
    const before = await wars(fund);
    const decisions = await runHeartbeat(ctx);
    const conversions = decisions.filter((d) => d.fund === fund);
    expect(conversions).toHaveLength(1);
    const [decision] = conversions;
    expect(decision).toMatchObject({ kind: "convert", status: "success" });
    expect(decision?.action).toMatchObject({ kind: "convert", usdtAmount: parseUnits("50", 6) });

    const usdtLeft = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [fund] });
    expect(usdtLeft).toBe(0n);
    const minWarsOut = decision?.action?.kind === "convert" ? decision.action.minWarsOut : 0n;
    expect((await wars(fund)) - before).toBeGreaterThanOrEqual(minWarsOut);
    const tx = await publicClient.getTransaction({ hash: decision?.tx ?? "0x" });
    expect(tx.input.endsWith(ATTRIBUTION_SUFFIX.slice(2))).toBe(true);
  });

  it("has nothing left to convert on the next heartbeat", async () => {
    expect((await runHeartbeat(ctx)).filter((d) => d.fund === fund)).toEqual([]);
  });

  it("pays the agreed expense back to the member, once", async () => {
    const before = await wars(beto.address);
    const pitch = { member: beto.address, amount: parseUnits("45000", 18), kind: "agreed", ref: ref(1), note: "Cancha" } as const;
    expect(await handleExpense(ctx, fund, pitch)).toMatchObject({ kind: "reimburse", status: "success" });
    expect((await wars(beto.address)) - before).toBe(parseUnits("45000", 18));
    expect(await handleExpense(ctx, fund, pitch)).toMatchObject({ kind: "reject", reason: expect.stringContaining("Already reimbursed") });
    expect(await wars(beto.address)).toBe(before + parseUnits("45000", 18));
  });

  it("turns what doesn't fit in the week's cap into a proposal for the members", async () => {
    const extra = { member: beto.address, amount: parseUnits("20000", 18), kind: "agreed", ref: ref(2), note: "Segunda cancha" } as const;
    expect(await handleExpense(ctx, fund, extra)).toMatchObject({ kind: "propose-payment", status: "success" });
    const proposal = await publicClient.readContract({ address: fund, abi: memberAbi, functionName: "getProposal", args: [0n] });
    expect(proposal).toMatchObject({
      action: 0,
      a: beto.address,
      amount: parseUnits("20000", 18),
      proposer: ctx.signer.address,
      note: "Segunda cancha",
    });
  });
});
