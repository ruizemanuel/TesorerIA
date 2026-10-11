import { FUND_FACTORY, USDT, WARS, fundFactoryAbi } from "@tesoreria/agent";
import { ATTRIBUTION_SUFFIX, type Call } from "@tesoreria/wallet";
import { eq } from "drizzle-orm";
import { type Address, type Hex, concat, decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, numberToHex, parseAbi } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_CREATE_FUND_GAS,
  MAX_CREATE_FUND_NONCES,
  MAX_FEE_MULTIPLE,
  MAX_OPERATION_GAS,
  type OperationCall,
  authorizeBundlerRequest,
  checkBundlerAnswer,
  checkBundlerRequest,
  checkCalls,
  checkSponsoredGas,
  claimCreateFundNonce,
  operationCalls,
} from "../src/lib/bundler-proxy";
import { contributeCalls } from "../src/lib/contribute";
import type { Db } from "../src/lib/db/client";
import { funds, memberships } from "../src/lib/db/schema";
import { memberFundAbi } from "../src/lib/fund-abi";
import { cancelDeploy, createDraft, deployCall, frozenCreateFunds, joinFund } from "../src/lib/funds";
import { voteCalls } from "../src/lib/vote";
import { AGENT } from "./support/fixtures";
import { WARS as WARS_UNIT, addLiveFund, addUser, randomAccount, testDb } from "./support/db";
import { MULTI_SEND, MULTI_SEND_CALL_ONLY, execute, multiSend, multiSendAbi, packed, safeCallData } from "./support/safe";

const ME = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const OTHER = getAddress("0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671");
const FUND = getAddress("0x00000000000000000000000000000000000F00D5");
const CELO = numberToHex(42220);
const POLICY = "sp_server";
const rpc = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 1, method, params });
const SPONSORED = ["pm_getPaymasterStubData", "eth_estimateUserOperationGas", "pm_getPaymasterData", "eth_sendUserOperation"];

const asRead = (calls: Call[]): OperationCall[] => calls.map(({ to, value = 0n, data = "0x" }) => ({ to, value, data }));

const createFundCall = (members: Address[] = [ME, OTHER, randomAccount()]): Call => ({
  to: FUND_FACTORY,
  data: encodeFunctionData({
    abi: fundFactoryAbi,
    functionName: "createFund",
    args: [{ name: "Fútbol", members, votesRequired: 2, agent: AGENT, agreedExpense: "la cancha", weeklyCap: 1n, balanceCap: 1n }],
  }),
});
const contribute = (fund: Address, token: "wars" | "usdt" = "wars") => contributeCalls({ fund, token, amount: 10n ** 18n });
const op = (sender: string, callData: string = safeCallData(contribute(FUND))) => ({ sender, nonce: "0x0", callData });

/** The settings a createFund's data carries. */
function createFundParams(data: Hex) {
  const decoded = decodeFunctionData({ abi: fundFactoryAbi, data });
  if (decoded.functionName !== "createFund") throw new Error(`Not a createFund: ${decoded.functionName}`);
  return decoded.args[0];
}

/** `call`'s createFund with some of its settings changed. */
function changed(call: Call, change: Partial<ReturnType<typeof createFundParams>>): Call {
  const params = { ...createFundParams(call.data!), ...change };
  return { to: FUND_FACTORY, data: encodeFunctionData({ abi: fundFactoryAbi, functionName: "createFund", args: [params] }) };
}

/**
 * A draft `creatorId` made, with three more people (so 2 and 3 votes both make a valid fund), frozen by deployCall
 * with 2 votes and AGENT: the createFund it handed the creator to sign.
 */
async function frozenDraft(db: Db, creatorId: string, name: string) {
  const created = await createDraft(db, creatorId, { name, agreedExpense: "la cancha", weeklyFee: 10_000n * WARS_UNIT, weeklyCap: 60_000n * WARS_UNIT });
  if (!created.ok) throw new Error(created.error);
  for (const person of ["Beto", "Caro", "Dani"]) await joinFund(db, (await addUser(db, person)).id, created.inviteCode);
  const deploy = await deployCall(db, { fundId: created.id, userId: creatorId, votesRequired: 2, agent: AGENT });
  if (!deploy.ok) throw new Error(deploy.error);
  return { fundId: created.id, call: deploy.call as Call };
}

describe("checkBundlerRequest", () => {
  it("lets a logged-in member send and sponsor their own operations, with the server's policy", () => {
    expect(checkBundlerRequest(rpc("eth_sendUserOperation", [op(ME), entryPoint07Address]), ME, POLICY)).toEqual({
      ok: true,
      request: { jsonrpc: "2.0", id: 1, method: "eth_sendUserOperation", params: [op(ME), entryPoint07Address] },
    });
    const stub = checkBundlerRequest(
      rpc("pm_getPaymasterStubData", [op(ME.toLowerCase()), entryPoint07Address, CELO, { sponsorshipPolicyId: "sp_mine" }]),
      ME,
      POLICY,
    );
    expect(stub).toMatchObject({ ok: true, request: { params: [op(ME.toLowerCase()), entryPoint07Address, CELO, { sponsorshipPolicyId: POLICY }] } });
    expect(checkBundlerRequest(rpc("eth_getUserOperationReceipt", ["0x01"]), ME, POLICY).ok).toBe(true);
    expect(checkBundlerRequest(rpc("pimlico_getUserOperationGasPrice"), ME, POLICY).ok).toBe(true);
  });

  it("refuses strangers, other accounts' operations, other methods, other chains and batches", () => {
    expect(checkBundlerRequest(rpc("eth_chainId"), null, POLICY)).toMatchObject({ ok: false, status: 401 });
    expect(checkBundlerRequest(rpc("eth_sendUserOperation", [op(OTHER), entryPoint07Address]), ME, POLICY)).toMatchObject({ ok: false, status: 403 });
    expect(checkBundlerRequest(rpc("eth_sendUserOperation", [op("not an address"), entryPoint07Address]), ME, POLICY)).toMatchObject({ ok: false, status: 403 });
    expect(checkBundlerRequest(rpc("eth_sendUserOperation", [op(ME), OTHER]), ME, POLICY)).toMatchObject({ ok: false, status: 400 });
    for (const method of ["eth_sendRawTransaction", "pimlico_sendUserOperationNow", "pm_sponsorUserOperation", "eth_call"]) {
      expect(checkBundlerRequest(rpc(method), ME, POLICY), method).toMatchObject({ ok: false, status: 403 });
    }
    const otherChain = rpc("pm_getPaymasterData", [op(ME), entryPoint07Address, numberToHex(1), {}]);
    expect(checkBundlerRequest(otherChain, ME, POLICY)).toMatchObject({ ok: false, status: 400 });
    expect(checkBundlerRequest([rpc("eth_chainId")], ME, POLICY)).toMatchObject({ ok: false, status: 400 });
    expect(checkBundlerRequest("eth_chainId", ME, POLICY)).toMatchObject({ ok: false, status: 400 });
  });

  it("estimates, sponsors or sends only an operation that ends with TesorerIA's attribution tag", () => {
    const CALL = safeCallData(contribute(FUND), false);
    for (const method of SPONSORED) {
      const params = (callData: unknown) => [{ ...op(ME), callData }, entryPoint07Address, CELO, {}];
      expect(checkBundlerRequest(rpc(method, params(concat([CALL, ATTRIBUTION_SUFFIX]))), ME, POLICY).ok, method).toBe(true);
      const shouted = concat([CALL, ATTRIBUTION_SUFFIX]).replace(/[a-f]/g, (letter) => letter.toUpperCase());
      expect(checkBundlerRequest(rpc(method, params(shouted)), ME, POLICY).ok, `${method}, in upper case`).toBe(true);
      for (const callData of ["0x", CALL, concat([ATTRIBUTION_SUFFIX, CALL]), undefined, 7]) {
        expect(checkBundlerRequest(rpc(method, params(callData)), ME, POLICY), `${method}: ${String(callData)}`).toMatchObject({
          ok: false,
          status: 400,
          error: "The operation must end with TesorerIA's attribution tag",
        });
      }
    }
  });
});

describe("operationCalls", () => {
  const [approve, contributeWars] = asRead(contribute(FUND)) as [OperationCall, OperationCall];

  it("reads the calls a Safe makes: one call, or a batch delegated to MultiSendCallOnly, tagged or not", () => {
    expect(operationCalls(safeCallData([approve]))).toEqual([approve]);
    expect(operationCalls(safeCallData([approve], false))).toEqual([approve]);
    expect(operationCalls(concat([execute(approve.to, 0n, approve.data, 0, "executeUserOp"), ATTRIBUTION_SUFFIX]))).toEqual([approve]);
    expect(operationCalls(safeCallData([approve, contributeWars]))).toEqual([approve, contributeWars]);
    expect(operationCalls(safeCallData([{ to: FUND, value: 5n }]))).toEqual([{ to: FUND, value: 5n, data: "0x" }]); // read as is: checkCalls refuses the value
  });

  it("reads nothing it can't be sure runs as it reads it", () => {
    const tag = (data: Hex) => concat([data, ATTRIBUTION_SUFFIX]);
    const batch = multiSend([approve, contributeWars]);
    const cases: Record<string, Hex> = {
      "another function of the Safe": tag(encodeFunctionData({ abi: parseAbi(["function setup(address)"]), args: [OTHER] })),
      "a delegatecall to anything but MultiSendCallOnly": tag(execute(OTHER, 0n, batch, 1)),
      "a delegatecall to MultiSend, which delegatecalls too": tag(execute(MULTI_SEND, 0n, batch, 1)),
      "a batch with value": tag(execute(MULTI_SEND_CALL_ONLY, 1n, batch, 1)),
      "a batch with a delegatecall inside": tag(execute(MULTI_SEND_CALL_ONLY, 0n, multiSend([{ ...approve, operation: 1 }]), 1)),
      "a batch cut short": tag(execute(MULTI_SEND_CALL_ONLY, 0n, encodeFunctionData({ abi: multiSendAbi, args: [packed([approve]).slice(0, -2) as Hex] }), 1)),
      "an empty batch": tag(execute(MULTI_SEND_CALL_ONLY, 0n, multiSend([]), 1)),
      "a batch that isn't multiSend": tag(execute(MULTI_SEND_CALL_ONLY, 0n, approve.data, 1)),
      "an operation that is neither a call nor a delegatecall": tag(execute(approve.to, 0n, approve.data, 2)),
      "bytes between the call and the tag": tag(concat([safeCallData([approve], false), `0x${"00".repeat(32)}`])),
      "nothing at all": tag("0x"),
    };
    for (const [why, callData] of Object.entries(cases)) expect(operationCalls(callData), why).toBeNull();
  });
});

describe("checkCalls", () => {
  const creating = createFundCall();
  const member = { liveFunds: [FUND], createFundCalls: [] };
  const creator = { liveFunds: [], createFundCalls: [creating.data!] };
  const fundCall = (to: Address, data: Hex, value = 0n): OperationCall => ({ to, value, data });

  it("lets a live fund's member approve it and contribute, in wARS or USDT, and vote and execute there", () => {
    for (const token of ["wars", "usdt"] as const) expect(checkCalls(asRead(contribute(FUND, token)), member)).toEqual({ ok: true, createsFund: false });
    for (const completes of [false, true]) {
      expect(checkCalls(asRead(voteCalls({ fund: FUND, proposalId: 3n, completes })), member)).toEqual({ ok: true, createsFund: false });
    }
  });

  it("refuses any other target, function or value", () => {
    const approve = (token: Address, spender: Address) => fundCall(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 1n] }));
    const cases: Record<string, OperationCall[]> = {
      "an approve to someone else": [approve(WARS, OTHER)],
      "an approve of another token": [approve(OTHER, FUND)],
      "a transfer": [fundCall(USDT, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [OTHER, 1n] }))],
      "a contribution to a fund they aren't live in": asRead(contribute(OTHER)),
      "a read of the fund": [fundCall(FUND, encodeFunctionData({ abi: memberFundAbi, functionName: "getProposal", args: [0n] }))],
      "another of the fund's functions": [fundCall(FUND, encodeFunctionData({ abi: parseAbi(["function distributeRemainder()"]) }))],
      "a call with value": [{ ...asRead(contribute(FUND))[1]!, value: 1n }],
      "a call with no data": [fundCall(FUND, "0x")],
      "createFund, by someone who isn't creating a fund": asRead([createFundCall()]),
    };
    for (const [why, calls] of Object.entries(cases)) expect(checkCalls(calls, member), why).toMatchObject({ ok: false, status: 403 });
  });

  it("lets only the creator of a fund being created send createFund, alone, and says it's one", () => {
    expect(checkCalls(asRead([creating]), creator)).toEqual({ ok: true, createsFund: true });
    expect(checkCalls(asRead([creating]), { ...creator, liveFunds: [FUND] })).toEqual({ ok: true, createsFund: true });
    expect(checkCalls(asRead([creating, ...contribute(FUND)]), { ...creator, liveFunds: [FUND] })).toMatchObject({ ok: false, status: 403 });
    expect(checkCalls(asRead([creating, creating]), creator)).toMatchObject({ ok: false, status: 403 });
    expect(checkCalls(asRead([{ ...creating, to: OTHER }]), creator)).toMatchObject({ ok: false, status: 403 });
    expect(checkCalls(asRead(contribute(FUND)), creator)).toMatchObject({ ok: false, status: 403 });
  });

  it("sponsors on the factory only the createFunds it's given, byte for byte in any case", () => {
    const another = createFundCall();
    const both = { liveFunds: [], createFundCalls: [creating.data!, another.data!] };
    for (const call of [creating, another]) expect(checkCalls(asRead([call]), both)).toEqual({ ok: true, createsFund: true });
    const shouted = creating.data!.replace(/[a-f]/g, (letter) => letter.toUpperCase()) as Hex;
    expect(checkCalls([{ to: FUND_FACTORY, value: 0n, data: shouted }], creator)).toEqual({ ok: true, createsFund: true });

    const cases: Record<string, Call> = {
      "another createFund": another,
      "another member": changed(creating, { members: [ME, OTHER, randomAccount()] }),
      "another votesRequired": changed(creating, { votesRequired: 3 }),
      "another agent": changed(creating, { agent: OTHER }),
      "a byte more": { to: FUND_FACTORY, data: concat([creating.data!, "0x00"]) },
      "another of the factory's functions": { to: FUND_FACTORY, data: encodeFunctionData({ abi: fundFactoryAbi, functionName: "fundCount" }) },
    };
    for (const [why, call] of Object.entries(cases)) {
      expect(checkCalls(asRead([call]), creator), why).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("createFund") });
    }
    expect(checkCalls(asRead([creating]), member)).toMatchObject({ ok: false, status: 403 });
  });
});

const FAST = 5_000_000_000n; // Pimlico's current "fast" maxFeePerGas: 5 gwei
const hex = (value: bigint) => numberToHex(value);
/** A prepared operation as viem sends it to pm_getPaymasterData, its limits adding up to `total`, unless changed. */
const sponsored = (sender: string, change: Record<string, unknown> = {}, total = MAX_OPERATION_GAS, callData?: string) => ({
  ...op(sender, callData),
  maxFeePerGas: hex(MAX_FEE_MULTIPLE * FAST),
  maxPriorityFeePerGas: hex(MAX_FEE_MULTIPLE * FAST),
  callGasLimit: hex(total - 600_000n),
  verificationGasLimit: hex(400_000n),
  preVerificationGas: hex(100_000n),
  paymasterVerificationGasLimit: hex(50_000n),
  paymasterPostOpGasLimit: hex(50_000n),
  ...change,
});

describe("checkSponsoredGas", () => {
  it("accepts an operation right at the ceilings, with or without the paymaster's own limits", () => {
    expect(checkSponsoredGas(sponsored(ME), FAST, MAX_OPERATION_GAS)).toEqual({ ok: true });
    const { paymasterVerificationGasLimit, paymasterPostOpGasLimit, ...bare } = sponsored(ME);
    expect(checkSponsoredGas(bare, FAST, MAX_OPERATION_GAS)).toEqual({ ok: true });
    expect(checkSponsoredGas(sponsored(ME, { maxFeePerGas: hex(FAST), maxPriorityFeePerGas: hex(1n) }), FAST, MAX_OPERATION_GAS)).toEqual({ ok: true });
    expect(checkSponsoredGas(sponsored(ME, {}, MAX_CREATE_FUND_GAS), FAST, MAX_CREATE_FUND_GAS)).toEqual({ ok: true });
  });

  it("refuses a fee above twice Pimlico's current price, or a tip above the fee", () => {
    const high = hex(MAX_FEE_MULTIPLE * FAST + 1n);
    expect(checkSponsoredGas(sponsored(ME, { maxFeePerGas: high, maxPriorityFeePerGas: hex(1n) }), FAST, MAX_OPERATION_GAS)).toMatchObject({ ok: false, status: 400 });
    expect(checkSponsoredGas(sponsored(ME, { maxFeePerGas: hex(FAST), maxPriorityFeePerGas: hex(FAST + 1n) }), FAST, MAX_OPERATION_GAS)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("refuses limits that add up to more than the ceiling it's given, the paymaster's included", () => {
    for (const name of ["callGasLimit", "verificationGasLimit", "preVerificationGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]) {
      const fields = sponsored(ME) as Record<string, string>;
      const one = { [name]: hex(BigInt(fields[name]!) + 1n) };
      expect(checkSponsoredGas(sponsored(ME, one), FAST, MAX_OPERATION_GAS), name).toMatchObject({ ok: false, status: 400 });
    }
    expect(checkSponsoredGas(sponsored(ME, {}, MAX_CREATE_FUND_GAS), FAST, MAX_OPERATION_GAS)).toMatchObject({ ok: false, status: 400 });
    expect(checkSponsoredGas(sponsored(ME, { callGasLimit: hex(2n ** 255n) }), FAST, MAX_CREATE_FUND_GAS)).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a field that is missing or not a hex quantity, so nothing is signed unread", () => {
    const required = ["maxFeePerGas", "maxPriorityFeePerGas", "callGasLimit", "verificationGasLimit", "preVerificationGas"];
    for (const name of required) {
      expect(checkSponsoredGas(sponsored(ME, { [name]: undefined }), FAST, MAX_OPERATION_GAS), `${name} missing`).toMatchObject({ ok: false, status: 400 });
    }
    for (const name of [...required, "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]) {
      for (const value of ["1000", "0x", "0xzz", "-0x1", 1000, null, `0x${"f".repeat(65)}`]) {
        expect(checkSponsoredGas(sponsored(ME, { [name]: value }), FAST, MAX_OPERATION_GAS), `${name}: ${String(value)}`).toMatchObject({ ok: false, status: 400 });
      }
    }
    expect(checkSponsoredGas("not an operation", FAST, MAX_OPERATION_GAS)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("checkBundlerAnswer", () => {
  const answer = (result: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 1, result });

  it("refuses a paymaster stub that says it's final: only the checked pm_getPaymasterData may sign", () => {
    const final = answer({ paymaster: OTHER, paymasterData: "0x1234", isFinal: true });
    expect(checkBundlerAnswer("pm_getPaymasterStubData", final)).toMatchObject({ ok: false, status: 502 });
    expect(checkBundlerAnswer("pm_getPaymasterStubData", answer({ paymaster: OTHER, paymasterData: "0x", isFinal: false }))).toEqual({ ok: true });
    expect(checkBundlerAnswer("pm_getPaymasterStubData", answer({ paymaster: OTHER, paymasterData: "0x" }))).toEqual({ ok: true });
    expect(checkBundlerAnswer("pm_getPaymasterStubData", JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "nope" } }))).toEqual({ ok: true });
    expect(checkBundlerAnswer("pm_getPaymasterStubData", "<html>Bad gateway</html>")).toEqual({ ok: true });
    expect(checkBundlerAnswer("pm_getPaymasterData", final)).toEqual({ ok: true });
  });
});

describe("authorizeBundlerRequest", () => {
  /** What `currentUser` gives: the account checksummed. */
  const asUser = (user: { id: string; account: string }) => ({ id: user.id, account: getAddress(user.account) });
  const price = async () => FAST;
  /** The server's agent, as `agentAddress` gives it. */
  const agent = () => AGENT;

  /** A stranger; someone only in a draft; a live fund's member; and the creator of a fund being created. */
  async function people() {
    const db: Db = await testDb();
    const stranger = await addUser(db, "Stranger");
    const founder = await addUser(db, "Founder");
    const juan = await addUser(db, "Juan");
    const ana = await addUser(db, "Ana");
    await addLiveFund(db, { creatorId: juan.id, address: FUND, members: [juan.id] });
    const [draft] = await db
      .insert(funds)
      .values({ name: "Draft", agreedExpense: "x", weeklyFee: 1n, weeklyCap: 1n, balanceCap: 1n, creatorId: stranger.id, inviteCode: "draft-code" })
      .returning();
    await db.insert(memberships).values({ fundId: draft!.id, userId: founder.id });
    const { call: anaCreate } = await frozenDraft(db, ana.id, "Creating");
    return { db, stranger, founder, juan, ana, anaCreate };
  }
  const request = (method: string, userOp: object) => rpc(method, method.startsWith("pm_") ? [userOp, entryPoint07Address, CELO, {}] : [userOp, entryPoint07Address]);

  it("sponsors only members of a live fund and the creator of a fund being created; the rest only read", async () => {
    const { db, stranger, founder, juan, ana, anaCreate } = await people();
    for (const method of SPONSORED) {
      const juanOp = request(method, sponsored(juan.account));
      const anaOp = request(method, sponsored(ana.account, {}, MAX_OPERATION_GAS, safeCallData([anaCreate])));
      expect(await authorizeBundlerRequest(db, asUser(juan), juanOp, POLICY, price, agent), method).toMatchObject({ ok: true });
      expect(await authorizeBundlerRequest(db, asUser(ana), anaOp, POLICY, price, agent), method).toMatchObject({ ok: true });
      for (const person of [stranger, founder]) {
        const refused = await authorizeBundlerRequest(db, asUser(person), request(method, sponsored(person.account)), POLICY, price, agent);
        expect(refused, `${method}: ${person.name}`).toMatchObject({ ok: false, status: 403 });
      }
    }
    // Reading the chain or a receipt costs the paymaster nothing: anyone in a fund, draft or live, may.
    for (const person of [founder, juan, ana]) {
      expect(await authorizeBundlerRequest(db, asUser(person), rpc("eth_getUserOperationReceipt", ["0x01"]), POLICY, price, agent), person.name).toMatchObject({ ok: true });
    }
    expect(await authorizeBundlerRequest(db, asUser(stranger), rpc("eth_chainId"), POLICY, price, agent)).toMatchObject({ ok: false, status: 403 });
    expect(await authorizeBundlerRequest(db, null, rpc("eth_chainId"), POLICY, price, agent)).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses calls off the list before reading any price, whoever asks", async () => {
    const { db, juan, ana, anaCreate } = await people();
    const reads = vi.fn(price);
    const cases: [{ id: string; account: string; name: string }, Hex][] = [
      [juan, safeCallData([anaCreate])], // not creating a fund: Ana's exact call is still Ana's
      [ana, safeCallData(contribute(FUND))], // not in a live fund
      [ana, safeCallData([anaCreate, ...contribute(FUND)])], // createFund, but not alone
      [juan, safeCallData(contribute(OTHER))], // someone else's fund
      [juan, safeCallData([{ to: USDT, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [OTHER, 1n] }) }])],
      [juan, concat([execute(OTHER, 0n, multiSend(contribute(FUND)), 1), ATTRIBUTION_SUFFIX])], // a delegatecall elsewhere
    ];
    for (const [person, callData] of cases) {
      for (const method of SPONSORED) {
        const refused = await authorizeBundlerRequest(db, asUser(person), request(method, sponsored(person.account, {}, MAX_OPERATION_GAS, callData)), POLICY, reads, agent);
        expect(refused, `${person.name}, ${method}: ${callData.slice(0, 74)}`).toMatchObject({ ok: false, status: 403 });
      }
    }
    expect(reads).not.toHaveBeenCalled();
  });

  it("gives the creator's createFund a ceiling of 10M gas, and every other operation one of 2M", async () => {
    const { db, juan, ana, anaCreate } = await people();
    const sign = (person: typeof ana, total: bigint, callData: Hex) =>
      authorizeBundlerRequest(db, asUser(person), request("pm_getPaymasterData", sponsored(person.account, {}, total, callData)), POLICY, price, agent);
    const create = safeCallData([anaCreate]);
    expect(await sign(ana, MAX_CREATE_FUND_GAS, create)).toMatchObject({ ok: true });
    expect(await sign(ana, MAX_CREATE_FUND_GAS + 1n, create)).toMatchObject({ ok: false, status: 400, error: "Gas limits too high" });
    for (const callData of [safeCallData(contribute(FUND)), safeCallData(contribute(FUND, "usdt")), safeCallData(voteCalls({ fund: FUND, proposalId: 0n, completes: true }))]) {
      expect(await sign(juan, MAX_OPERATION_GAS, callData)).toMatchObject({ ok: true });
      expect(await sign(juan, MAX_OPERATION_GAS + 1n, callData)).toMatchObject({ ok: false, status: 400, error: "Gas limits too high" });
    }
    expect(MAX_OPERATION_GAS).toBe(2_000_000n);
    expect(MAX_CREATE_FUND_GAS).toBe(10_000_000n);
  });

  it("holds a sponsoring request to the current price, which it reads only when it has to", async () => {
    const { db, juan } = await people();
    const reads = vi.fn(price);
    const sponsor = (change: Record<string, unknown> = {}) => request("pm_getPaymasterData", sponsored(juan.account, change));

    const ok = await authorizeBundlerRequest(db, asUser(juan), sponsor(), POLICY, reads, agent);
    expect(ok).toMatchObject({ ok: true, request: { params: [sponsored(juan.account), entryPoint07Address, CELO, { sponsorshipPolicyId: POLICY }] } });
    expect(reads).toHaveBeenCalledTimes(1);
    const high = { maxFeePerGas: hex(MAX_FEE_MULTIPLE * FAST + 1n) };
    expect(await authorizeBundlerRequest(db, asUser(juan), sponsor(high), POLICY, reads, agent)).toMatchObject({ ok: false, status: 400 });

    reads.mockClear();
    const answers = await Promise.all([
      authorizeBundlerRequest(db, null, sponsor(), POLICY, reads, agent), // logged out
      authorizeBundlerRequest(db, asUser(juan), request("pm_getPaymasterData", sponsored(OTHER)), POLICY, reads, agent), // someone else's operation
      authorizeBundlerRequest(db, asUser(juan), rpc("eth_chainId"), POLICY, reads, agent), // nothing is sponsored
      // The send itself isn't what the paymaster signs: its fees are fixed by then (and checked when it signed).
      authorizeBundlerRequest(db, asUser(juan), request("eth_sendUserOperation", sponsored(juan.account, high)), POLICY, reads, agent),
    ]);
    expect(answers.map((answer) => answer.ok)).toEqual([false, false, true, true]);
    expect(reads).not.toHaveBeenCalled();
  });

  it("refuses with 502 when the price can't be read, instead of signing blind", async () => {
    const { db, juan } = await people();
    const broken = vi.fn(async (): Promise<bigint> => {
      throw new Error("Pimlico is down");
    });
    expect(await authorizeBundlerRequest(db, asUser(juan), request("pm_getPaymasterData", sponsored(juan.account)), POLICY, broken, agent)).toMatchObject({
      ok: false,
      status: 502,
    });
  });

  it("doesn't look at fees or gas without a price, as on the fork, which has no paymaster, but still at who and what", async () => {
    const { db, juan, founder, anaCreate } = await people();
    const heavy = { maxFeePerGas: hex(1000n * FAST), callGasLimit: hex(8_000_000n), verificationGasLimit: hex(2_000_000n) };
    expect(await authorizeBundlerRequest(db, asUser(juan), request("pm_getPaymasterData", sponsored(juan.account, heavy)), POLICY, null, agent)).toMatchObject({ ok: true });
    const createFund = sponsored(juan.account, heavy, MAX_OPERATION_GAS, safeCallData([anaCreate]));
    expect(await authorizeBundlerRequest(db, asUser(juan), request("pm_getPaymasterData", createFund), POLICY, null, agent)).toMatchObject({ ok: false, status: 403 });
    expect(await authorizeBundlerRequest(db, asUser(founder), request("pm_getPaymasterData", sponsored(founder.account)), POLICY, null, agent)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("reads the server's agent only for someone creating a fund, so a bad agent key stops nobody else", async () => {
    const { db, founder, juan, ana, anaCreate } = await people();
    const badKey = vi.fn((): Address => {
      throw new Error("bad key");
    });
    const contribution = request("pm_getPaymasterData", sponsored(juan.account));
    expect(await authorizeBundlerRequest(db, asUser(juan), contribution, POLICY, price, badKey)).toMatchObject({ ok: true });
    for (const person of [founder, juan, ana]) {
      const reading = await authorizeBundlerRequest(db, asUser(person), rpc("eth_getUserOperationReceipt", ["0x01"]), POLICY, price, badKey);
      expect(reading, person.name).toMatchObject({ ok: true });
    }
    expect(badKey).not.toHaveBeenCalled();
    // Ana's createFund names the agent, so it can't be checked without it.
    const create = request("pm_getPaymasterStubData", sponsored(ana.account, {}, MAX_OPERATION_GAS, safeCallData([anaCreate])));
    await expect(authorizeBundlerRequest(db, asUser(ana), create, POLICY, price, badKey)).rejects.toThrow("bad key");
  });

  describe("the only createFund it sponsors: the one deployCall built for the creator's frozen draft", () => {
    /** Each sponsored method's answer to `person` sending `calls`, with `server` as the server's agent. */
    const answers = (db: Db, person: { id: string; account: string }, calls: Call[], server: () => Address = agent) =>
      Promise.all(
        SPONSORED.map((method) =>
          authorizeBundlerRequest(db, asUser(person), request(method, sponsored(person.account, {}, MAX_CREATE_FUND_GAS, safeCallData(calls))), POLICY, price, server),
        ),
      );
    const allowed = { ok: true };
    const refused = { ok: false, status: 403, error: expect.stringContaining("createFund") };

    it("sponsors the creator's exact call, and not that call with any one argument changed", async () => {
      const db = await testDb();
      const ana = await addUser(db, "Ana");
      const { call } = await frozenDraft(db, ana.id, "Fútbol");
      for (const answer of await answers(db, ana, [call])) expect(answer).toMatchObject(allowed);

      const { members, weeklyCap } = createFundParams(call.data!);
      const cases: Record<string, Parameters<typeof changed>[1]> = {
        "another member": { members: [...members.slice(0, -1), randomAccount()] },
        "a member more": { members: [...members, randomAccount()] },
        "the members in another order": { members: [...members].reverse() },
        "another votesRequired": { votesRequired: 3 },
        "another agent": { agent: OTHER },
        "another name": { name: "Asado" },
        "another weekly cap": { weeklyCap: weeklyCap + 1n },
      };
      for (const [why, change] of Object.entries(cases)) {
        for (const answer of await answers(db, ana, [changed(call, change)])) expect(answer, why).toMatchObject(refused);
      }
      // The exact call, but the server names another agent: not the fund the server would run.
      for (const answer of await answers(db, ana, [call], () => OTHER)) expect(answer).toMatchObject(refused);
    });

    it("refuses the call of a draft that is open again (`draft`), not being created", async () => {
      const db = await testDb();
      const ana = await addUser(db, "Ana");
      await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id] }); // sponsored for her live fund, so the call itself is what's refused
      const { fundId, call } = await frozenDraft(db, ana.id, "Fútbol");
      expect(await cancelDeploy(db, { fundId, userId: ana.id })).toEqual({ ok: true, reopened: true });
      for (const answer of await answers(db, ana, [call])) expect(answer).toMatchObject(refused);
    });

    it("refuses the call of a draft that went live: it's no longer being created", async () => {
      const db = await testDb();
      const ana = await addUser(db, "Ana");
      const { fundId, call } = await frozenDraft(db, ana.id, "Fútbol");
      expect(await frozenCreateFunds(db, ana.id, agent)).toEqual([call.data]);
      await db.update(funds).set({ status: "live", address: FUND, createdBlock: 79_700_000n }).where(eq(funds.id, fundId));
      const unread = () => {
        throw new Error("Nothing being created needs the agent");
      };
      expect(await frozenCreateFunds(db, ana.id, unread)).toEqual([]);
      for (const answer of await answers(db, ana, [call])) expect(answer).toMatchObject(refused); // a member of it now, so the call is what's refused
    });

    it("gives each draft's call with its members in the order they joined, and by id at the same instant, as deployCall does", async () => {
      const db = await testDb();
      const ana = await addUser(db, "Ana");
      const people = await Promise.all(["Beto", "Caro", "Dani", "Eli"].map((name) => addUser(db, name)));
      const at = (minutes: number) => new Date(Date.UTC(2026, 9, 10, 12, minutes));
      const calls: Hex[] = [];
      for (const [i, name] of ["Fútbol", "Asado"].entries()) {
        const created = await createDraft(db, ana.id, { name, agreedExpense: "la cancha", weeklyFee: 10_000n * WARS_UNIT, weeklyCap: 60_000n * WARS_UNIT });
        if (!created.ok) throw new Error(created.error);
        await db.update(memberships).set({ joinedAt: at(0) }).where(eq(memberships.fundId, created.id));
        // The two drafts' joins interleave in time, each in another order than the people were added in, and two of
        // each draft's people join at the same instant.
        for (const [j, person] of (i === 0 ? [...people].reverse() : people).entries()) {
          await db.insert(memberships).values({ fundId: created.id, userId: person.id, joinedAt: at(2 * Math.max(j, 1) + i) });
        }
        const deploy = await deployCall(db, { fundId: created.id, userId: ana.id, votesRequired: 2, agent: AGENT });
        if (!deploy.ok) throw new Error(deploy.error);
        calls.push(deploy.call.data);
      }
      expect([...(await frozenCreateFunds(db, ana.id, agent))].sort()).toEqual([...calls].sort());
    });

    it("sponsors each of two drafts being created with its own exact call, one at a time", async () => {
      const db = await testDb();
      const ana = await addUser(db, "Ana");
      const futbol = await frozenDraft(db, ana.id, "Fútbol");
      const asado = await frozenDraft(db, ana.id, "Asado");
      for (const { call } of [futbol, asado]) {
        for (const answer of await answers(db, ana, [call])) expect(answer).toMatchObject(allowed);
      }
      for (const answer of await answers(db, ana, [changed(futbol.call, { name: "Asado" })])) expect(answer).toMatchObject(refused);
      for (const answer of await answers(db, ana, [futbol.call, asado.call])) expect(answer).toMatchObject({ ok: false, status: 403 });
    });
  });

  describe("a creator's createFund: on nonce key 0, and at most MAX_CREATE_FUND_NONCES nonces signed, ever", () => {
    /** Someone creating a fund, and the createFund deployCall built for their frozen draft. */
    async function creator(db: Db, name: string) {
      const person = await addUser(db, name);
      return { person, call: (await frozenDraft(db, person.id, `${name}'s`)).call };
    }
    /** `method` with `person`'s createFund `call` on EntryPoint nonce `nonce`, a quantity or whatever a browser could send. */
    const createFund = (method: string, person: { account: string }, call: Call, nonce: unknown) =>
      request(method, sponsored(person.account, { nonce: typeof nonce === "bigint" ? hex(nonce) : nonce }, MAX_CREATE_FUND_GAS, safeCallData([call])));
    const sign = (db: Db, { person, call }: Awaited<ReturnType<typeof creator>>, nonce: bigint, fast: typeof price | null = price) =>
      authorizeBundlerRequest(db, asUser(person), createFund("pm_getPaymasterData", person, call, nonce), POLICY, fast, agent);
    const signed = { ok: true };
    const capped = { ok: false, status: 403, error: `This account already had ${MAX_CREATE_FUND_NONCES} createFunds sponsored; no more are` };

    it("signs nonces 0, 1 and 2, refuses a fourth, and still signs one it already signed, which can't land twice", async () => {
      const db = await testDb();
      const ana = await creator(db, "Ana");
      for (const nonce of [0n, 1n, 2n]) expect(await sign(db, ana, nonce), `nonce ${nonce}`).toMatchObject(signed);
      expect(await sign(db, ana, 3n)).toEqual(capped);
      expect(await sign(db, ana, 0n)).toMatchObject(signed);
      expect(MAX_CREATE_FUND_NONCES).toBe(3);
    });

    it("counts a nonce signed twice once", async () => {
      const db = await testDb();
      const ana = await creator(db, "Ana");
      for (const nonce of [0n, 0n, 1n, 2n]) expect(await sign(db, ana, nonce), `nonce ${nonce}`).toMatchObject(signed);
      expect(await sign(db, ana, 3n)).toEqual(capped);
    });

    it("counts only what the paymaster signs: not estimates, stubs or sends, nor a signature refused for its gas or price", async () => {
      const db = await testDb();
      const ana = await creator(db, "Ana");
      for (const method of ["eth_estimateUserOperationGas", "pm_getPaymasterStubData", "eth_sendUserOperation"]) {
        for (const nonce of [5n, 6n, 7n, 8n, 9n]) {
          const answer = await authorizeBundlerRequest(db, asUser(ana.person), createFund(method, ana.person, ana.call, nonce), POLICY, price, agent);
          expect(answer, `${method}, nonce ${nonce}`).toMatchObject(signed);
        }
      }
      const greedy = (nonce: bigint) =>
        request("pm_getPaymasterData", sponsored(ana.person.account, { nonce: hex(nonce) }, MAX_CREATE_FUND_GAS + 1n, safeCallData([ana.call])));
      for (const nonce of [10n, 11n, 12n]) {
        expect(await authorizeBundlerRequest(db, asUser(ana.person), greedy(nonce), POLICY, price, agent)).toMatchObject({ ok: false, status: 400 });
      }
      const down = async (): Promise<bigint> => {
        throw new Error("Pimlico is down");
      };
      for (const nonce of [13n, 14n, 15n]) expect(await sign(db, ana, nonce, down)).toMatchObject({ ok: false, status: 502 });
      for (const nonce of [0n, 1n, 2n]) expect(await sign(db, ana, nonce), `nonce ${nonce}`).toMatchObject(signed);
    });

    it("refuses a createFund on any other nonce key with 403, and one without a nonce it can read with 400, whatever the method", async () => {
      const db = await testDb();
      const ana = await creator(db, "Ana");
      const ask = (method: string, nonce: unknown) =>
        authorizeBundlerRequest(db, asUser(ana.person), createFund(method, ana.person, ana.call, nonce), POLICY, price, agent);
      for (const method of SPONSORED) {
        for (const nonce of [1n << 64n, (1n << 64n) + 1n, ((1n << 192n) - 1n) << 64n]) {
          expect(await ask(method, nonce), `${method}: ${hex(nonce)}`).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("key 0") });
        }
        for (const nonce of [undefined, null, 0, "0", "0x", "0xzz", "-0x1", `0x${"f".repeat(65)}`]) {
          expect(await ask(method, nonce), `${method}: ${String(nonce)}`).toMatchObject({ ok: false, status: 400 });
        }
      }
      for (const nonce of [0n, 1n, 2n]) expect(await sign(db, ana, nonce), `nonce ${nonce}`).toMatchObject(signed); // none of those used one up
    });

    it("counts per creator: another one still gets their own first nonce signed", async () => {
      const db = await testDb();
      const ana = await creator(db, "Ana");
      const bea = await creator(db, "Bea");
      for (const nonce of [0n, 1n, 2n]) expect(await sign(db, ana, nonce), `nonce ${nonce}`).toMatchObject(signed);
      expect(await sign(db, ana, 3n)).toEqual(capped);
      expect(await sign(db, bea, 0n)).toMatchObject(signed);
    });

    it("holds the cap on the fork too, where there's no price to check the gas against", async () => {
      const db = await testDb();
      const ana = await creator(db, "Ana");
      for (const nonce of [0n, 1n, 2n]) expect(await sign(db, ana, nonce, null), `nonce ${nonce}`).toMatchObject(signed);
      expect(await sign(db, ana, 3n, null)).toEqual(capped);
    });

    it("leaves a live member's contributions and votes alone, on whatever key viem picks", async () => {
      const { db, juan } = await people();
      const shapes = [contribute(FUND), contribute(FUND, "usdt"), voteCalls({ fund: FUND, proposalId: 0n, completes: false }), voteCalls({ fund: FUND, proposalId: 0n, completes: true })];
      for (const calls of [...shapes, ...shapes]) {
        const nonce = BigInt(Math.floor(Math.random() * 2 ** 48) + 1) << 64n; // a fresh non-zero key, as viem picks one
        const answer = await authorizeBundlerRequest(
          db,
          asUser(juan),
          request("pm_getPaymasterData", sponsored(juan.account, { nonce: hex(nonce) }, MAX_OPERATION_GAS, safeCallData(calls))),
          POLICY,
          price,
          agent,
        );
        expect(answer, hex(nonce)).toMatchObject(signed);
      }
    });

    it("lets exactly MAX_CREATE_FUND_NONCES of many claims made at once through", async () => {
      // PGlite runs one transaction at a time anyway, so this guards against a regression rather than proving the
      // lock: on Neon, the lock on the user's row is what keeps two claims from counting the same rows.
      const db = await testDb();
      const ana = await addUser(db, "Ana");
      const claims = await Promise.all(Array.from({ length: MAX_CREATE_FUND_NONCES + 2 }, (_, i) => claimCreateFundNonce(db, ana.id, BigInt(i))));
      expect(claims.filter(Boolean)).toHaveLength(MAX_CREATE_FUND_NONCES);
    });
  });
});
