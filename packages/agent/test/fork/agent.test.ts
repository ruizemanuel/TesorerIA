import { ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
import {
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
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
  zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { beforeAll, describe, expect, it } from "vitest";
import { Action, fundFactoryAbi, fundFactoryV2Abi, fundV2Abi } from "../../src/abi";
import { FEE_RECIPIENT, FUND_FACTORY, FUND_FACTORY_V2, POOL, USDT, WARS } from "../../src/chain";
import { CURRENCIES, type Currency, FEE_BPS, currencyOf, servedProblem } from "../../src/currencies";
import { checkDollarPool } from "../../src/deploy";
import { rpcLogReader } from "../../src/events";
import { WEEK, readFund } from "../../src/fund";
import { type ContractReader, quoteConversion, readReferences } from "../../src/market";
import { type AgentContext, type Decision, handleExpense, runHeartbeat } from "../../src/run";
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
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
  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
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
  const { dollarUsd } = await readReferences({ base: answering(1n, 0n), celo: publicClient }, currencyOf(WARS) as Currency);
  const { quotedCurrency } = await quoteConversion(publicClient, await readFund(publicClient, { address: fund, version: 1 }), 1_000_000n);
  // For 1 USDT, Chainlink's wARS are 100 × currencyUsd × dollarUsd (8 decimals each): pick currencyUsd to match the pool.
  return answering(quotedCurrency / (100n * dollarUsd.answer), BigInt(Math.floor(Date.now() / 1000)));
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
    expect(decision?.action).toMatchObject({ kind: "convert", dollarAmount: parseUnits("50", 6) });

    const usdtLeft = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [fund] });
    expect(usdtLeft).toBe(0n);
    const minCurrencyOut = decision?.action?.kind === "convert" ? decision.action.minCurrencyOut : 0n;
    expect((await wars(fund)) - before).toBeGreaterThanOrEqual(minCurrencyOut);
    const tx = await publicClient.getTransaction({ hash: decision?.tx ?? "0x" });
    expect(tx.input.endsWith(ATTRIBUTION_SUFFIX.slice(2))).toBe(true);
  });

  it("has nothing left to convert on the next heartbeat", async () => {
    expect((await runHeartbeat(ctx)).filter((d) => d.fund === fund)).toEqual([]);
  });

  it("pays the agreed expense back to the member, once", async () => {
    const before = await wars(beto.address);
    const enteredAt = BigInt(Math.floor(Date.now() / 1000));
    const pitch = { member: beto.address, amount: parseUnits("45000", 18), kind: "agreed", ref: ref(1), note: "Cancha", enteredAt } as const;
    expect(await handleExpense(ctx, fund, pitch)).toMatchObject({ kind: "reimburse", status: "success" });
    expect((await wars(beto.address)) - before).toBe(parseUnits("45000", 18));
    expect(await handleExpense(ctx, fund, pitch)).toMatchObject({ kind: "reject", reason: expect.stringContaining("Already reimbursed") });
    expect(await wars(beto.address)).toBe(before + parseUnits("45000", 18));
  });

  it("turns what doesn't fit in the week's cap into a proposal for the members", async () => {
    const enteredAt = BigInt(Math.floor(Date.now() / 1000));
    const extra = { member: beto.address, amount: parseUnits("20000", 18), kind: "agreed", ref: ref(2), note: "Segunda cancha", enteredAt } as const;
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

/** Moves the fork's clock `seconds` ahead and mines a block on it: how a week ends on the fork. */
async function advanceClock(seconds: bigint) {
  await testClient.increaseTime({ seconds: Number(seconds) });
  await testClient.mine({ blocks: 1 });
}

/** The receipt of the transaction a decision sent. */
function receiptOf(decision: Decision | undefined): Promise<TransactionReceipt> {
  if (decision?.tx === undefined) throw new Error(`The decision sent no transaction: ${decision?.kind} (${decision?.reason})`);
  return publicClient.getTransactionReceipt({ hash: decision.tx });
}

/** A member creates a fund on the deployed FundFactoryV2, with this agent and the table's fee, and returns its address. */
async function createFundV2(params: { name: string; currency: Address; dollar: Address; pool: Address; weeklyCap: bigint; balanceCap: bigint }) {
  const created = await send(
    ana,
    FUND_FACTORY_V2,
    encodeFunctionData({
      abi: fundFactoryV2Abi,
      functionName: "createFund",
      args: [
        {
          ...params,
          members: members.map((m) => m.address),
          votesRequired: 2,
          agent: ctx.signer.address,
          agreedExpense: "Pitch",
          feeBps: FEE_BPS,
        },
      ],
    }),
  );
  const [event] = parseEventLogs({ abi: fundFactoryV2Abi, eventName: "FundCreated", logs: created.logs });
  if (event === undefined) throw new Error("no FundCreated");
  return event.args.fund;
}

describe("FundV2 on the deployed FundFactoryV2", () => {
  const dollarsOf = { ana: parseUnits("3", 6), beto: parseUnits("4", 6) };
  let fundV2: Address;

  beforeAll(async () => {
    fundV2 = await createFundV2({
      name: "Fork v2",
      currency: WARS,
      dollar: USDT,
      pool: POOL,
      weeklyCap: WEEKLY_CAP,
      balanceCap: parseUnits("450000", 18),
    });
    for (const [member, amount] of [
      [ana, dollarsOf.ana],
      [beto, dollarsOf.beto],
    ] as const) {
      await giveFromPool(USDT, member.address, amount);
      await send(member, USDT, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [fundV2, amount] }));
      await send(member, fundV2, encodeFunctionData({ abi: fundV2Abi, functionName: "contributeDollar", args: [amount] }));
    }
  });

  const snapshot = (address: Address = fundV2) => readFund(publicClient, { address, version: 2 });

  it("converts both in one swap", async () => {
    const pending = await snapshot();
    expect(pending.pendingDollar).toEqual([dollarsOf.ana, dollarsOf.beto, 0n]);
    expect(servedProblem(pending)).toBeNull();

    const decisions = (await runHeartbeat(ctx)).filter((d) => d.fund === fundV2);
    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    expect(decision).toMatchObject({ kind: "convert", status: "success" });
    expect(decision?.action).toMatchObject({
      kind: "convert",
      dollarAmount: dollarsOf.ana + dollarsOf.beto,
      members: [ana.address, beto.address],
      amounts: [dollarsOf.ana, dollarsOf.beto],
    });
    const receipt = await receiptOf(decision);
    const tx = await publicClient.getTransaction({ hash: receipt.transactionHash });
    expect(tx.input.endsWith(ATTRIBUTION_SUFFIX.slice(2))).toBe(true);

    const conversions = parseEventLogs({ abi: fundV2Abi, eventName: "Conversion", logs: receipt.logs }).filter(
      (log) => log.address.toLowerCase() === fundV2.toLowerCase(),
    );
    expect(conversions.map((c) => [c.args.member, c.args.dollarIn])).toEqual([
      [ana.address, dollarsOf.ana],
      [beto.address, dollarsOf.beto],
    ]);

    const after = await snapshot();
    expect(after.contributed).toEqual([conversions[0]?.args.credited, conversions[1]?.args.credited, 0n]);
    expect(after.pendingDollar).toEqual([0n, 0n, 0n]);
    expect(after.totalPendingDollar).toBe(0n);
    // What the swap delivered, less what was credited, is the fee set aside.
    const received = conversions.reduce((sum, c) => sum + c.args.currencyOut, 0n);
    expect(after.feeOwed).toBeGreaterThan(0n);
    expect(after.feeOwed).toBe(received - after.totalContributed);
  });

  it("has nothing left to convert on the next heartbeat", async () => {
    expect((await runHeartbeat(ctx)).filter((d) => d.fund === fundV2)).toEqual([]);
  });

  it("proposes a GiveBack, and the members' votes give the money back", async () => {
    const before = await snapshot();
    const amount = (before.contributed[0] ?? 0n) / 2n;
    expect(amount).toBeGreaterThan(0n);
    const enteredAt = BigInt(Math.floor(Date.now() / 1000));
    const expense = { member: ana.address, amount, kind: "give-back", ref: ref(10), note: "Back to Ana", enteredAt } as const;
    const decision = await handleExpense(ctx, fundV2, expense);
    expect(decision).toMatchObject({ kind: "propose-give-back", status: "success" });

    const [created] = parseEventLogs({ abi: fundV2Abi, eventName: "ProposalCreated", logs: (await receiptOf(decision)).logs });
    expect(created?.args).toMatchObject({ action: 8, a: ana.address, amount, proposer: ctx.signer.address, note: "Back to Ana" });
    expect(Action.GiveBack).toBe(8);
    const id = created?.args.id ?? 0n;

    // The agent isn't a member and doesn't vote: two members do, and anyone may execute.
    const call = (functionName: "vote" | "execute") => encodeFunctionData({ abi: fundV2Abi, functionName, args: [id] });
    await send(ana, fundV2, call("vote"));
    await send(beto, fundV2, call("vote"));
    const warsBefore = await wars(ana.address);
    const executed = await send(ana, fundV2, call("execute"));
    const [givenBack] = parseEventLogs({ abi: fundV2Abi, eventName: "ContributionGivenBack", logs: executed.logs });
    expect(givenBack?.args).toEqual({ member: ana.address, amount });

    const after = await snapshot();
    expect(after.contributed[0]).toBe((before.contributed[0] ?? 0n) - amount);
    expect(after.totalContributed).toBe(before.totalContributed - amount);
    expect((await wars(ana.address)) - warsBefore).toBe(amount);
  });

  it("reads a wMXN fund without a dollar", async () => {
    const mxn = CURRENCIES.find((c) => c.symbol === "wMXN") as Currency;
    const fundMxn = await createFundV2({
      name: "Fork wMXN",
      currency: mxn.token,
      dollar: zeroAddress,
      pool: zeroAddress,
      // v2 needs weeklyCap <= balanceCap, so WEEKLY_CAP (60,000) would revert: the table's cap, and a weekly one under it.
      weeklyCap: parseUnits("1000", 18),
      balanceCap: parseUnits("5000", 18),
    });
    const read = await snapshot(fundMxn);
    expect(read).toMatchObject({
      version: 2,
      agent: ctx.signer.address,
      currency: mxn.token,
      dollar: null,
      pool: null,
      feeBps: FEE_BPS,
      feeOwed: 0n,
      weeklyCap: parseUnits("1000", 18),
      balanceCap: parseUnits("5000", 18),
      currencyBalance: 0n,
      dollarBalance: 0n,
      pendingDollar: [0n, 0n, 0n],
      pendingValue: [0n, 0n, 0n],
      totalPendingDollar: 0n,
    });
    expect(servedProblem(read)).toBeNull();

    expect((await runHeartbeat(ctx)).filter((d) => d.fund === fundMxn)).toEqual([]);
    // An agreed expense can't be paid back from a fund with no wMXN: it waits, and nothing goes on chain.
    const enteredAt = BigInt(Math.floor(Date.now() / 1000));
    const expense = { member: ana.address, amount: parseUnits("500", 18), kind: "agreed", ref: ref(11), note: "Cancha", enteredAt } as const;
    const decision = await handleExpense(ctx, fundMxn, expense);
    expect(decision).toMatchObject({ kind: "wait", reason: expect.stringContaining("wMXN") });
    expect(decision.tx).toBeUndefined();
  });

  it("checkDollarPool passes for every currency with a dollar", async () => {
    const withDollar = CURRENCIES.filter((c) => c.dollar !== null);
    expect(withDollar.length).toBeGreaterThan(0);
    for (const currency of withDollar) {
      await expect(checkDollarPool(publicClient as PublicClient, currency)).resolves.toMatchObject({ cardinality: expect.any(Number) });
    }
  });

  // Last, because it moves the fork's clock a week ahead.
  it("sends the fee in week 1", async () => {
    const owed = (await snapshot()).feeOwed;
    expect(owed).toBeGreaterThan(0n);
    await advanceClock(WEEK);
    expect((await snapshot()).week).toBe(1n);

    const recipientBefore = await wars(FEE_RECIPIENT);
    const decisions = (await runHeartbeat(ctx)).filter((d) => d.fund === fundV2);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: "pay-fee", status: "success" });
    const [paid] = parseEventLogs({ abi: fundV2Abi, eventName: "FeePaid", logs: (await receiptOf(decisions[0])).logs });
    expect(paid?.args.amount).toBe(owed);
    expect((await wars(FEE_RECIPIENT)) - recipientBefore).toBe(owed);
    expect((await snapshot()).feeOwed).toBe(0n);
  });
});
