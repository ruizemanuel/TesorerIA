import {
  type Address,
  type Hash,
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddressEqual,
  parseEther,
  parseEventLogs,
  parseGwei,
} from "viem";
import {
  type SmartAccount,
  type UserOperation,
  entryPoint07Abi,
  entryPoint07Address,
  toPackedUserOperation,
  toWebAuthnAccount,
} from "viem/account-abstraction";
import { celo } from "viem/chains";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type AccountKind,
  ATTRIBUTION_SUFFIX,
  type Call,
  createMemberAccount,
  createTaggedBundlerClient,
  isUserOpAttributed,
} from "../../src";
import { ANVIL_RPC_URL } from "../support/anvil.globalSetup";
import { type FakePasskey, createFakePasskey } from "../support/fakePasskey";

const USDT: Address = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const USDT_HOLDER: Address = "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391"; // wARS/USDT pool, impersonated
const KERNEL_META_FACTORY = "0xd703aaE79538628d27099B8c4f621bE4CCd142d5";
const PATCHED_WEBAUTHN_VALIDATOR = "7ab16ff354acb328452f1d445b3ddee9a91e9e69";
const UNPATCHED_WEBAUTHN_VALIDATORS = ["d990393c", "ba45a2bf"];
const SAFE_WEBAUTHN_SHARED_SIGNER = "94a4f6affbd8975951142c3999aeab7ecee555c2";
const SAFE_P256_VERIFIERS_WORD = "0100a86e0054c51e4894d88762a017ecc5e5235f5dba";
const SAFE_FCL_VERIFIER: Address = "0xA86e0054C51E4894D88762a017ECc5E5235f5DBA"; // Safe's fallback if the precompile fails
const P256_VERIFIER: Record<AccountKind, Address> = {
  safe: "0x0000000000000000000000000000000000000100", // precompile
  kernel: "0xc2b78104907F722DABAc4C69f826a522B2754De4", // Daimo P256Verifier
};
const GAS_LIMITS = { callGasLimit: 500_000n, verificationGasLimit: 2_000_000n, preVerificationGas: 100_000n };

const transport = http(ANVIL_RPC_URL);
const publicClient = createPublicClient({ chain: celo, transport });
const testClient = createTestClient({ chain: celo, mode: "anvil", transport });
const walletClient = createWalletClient({ chain: celo, transport });
// Production's prepareUserOperation path; with every gas and fee field given it never
// needs a bundler, and this transport throws if anything tries to reach one.
const bundlerClient = createTaggedBundlerClient({
  client: publicClient,
  transport: custom({
    async request({ method }) {
      throw new Error(`unexpected bundler RPC: ${method}`);
    },
  }),
});

function toAccount(kind: AccountKind, passkey: FakePasskey): Promise<SmartAccount> {
  const owner = toWebAuthnAccount({ ...passkey, rpId: "localhost" });
  return createMemberAccount({ client: publicClient, owner, kind });
}

function usdtBalance(address: Address): Promise<bigint> {
  return publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

function usdtTransfer(to: Address, amount: bigint): Call {
  return { to: USDT, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) };
}

async function prepare(account: SmartAccount, calls: Call[]): Promise<UserOperation<"0.7">> {
  const { baseFeePerGas } = await publicClient.getBlock();
  const userOp = await bundlerClient.prepareUserOperation({
    account,
    calls,
    ...GAS_LIMITS,
    maxFeePerGas: baseFeePerGas! * 2n,
    maxPriorityFeePerGas: parseGwei("1"),
  });
  return userOp as UserOperation<"0.7">;
}

function handleOpsArgs(userOps: UserOperation<"0.7">[], beneficiary: Address) {
  return {
    address: entryPoint07Address,
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [userOps.map((op) => toPackedUserOperation(op)), beneficiary],
  } as const;
}

/** Acts as the bundler: submits handleOps from an anvil dev account. */
async function sendHandleOps(userOp: UserOperation<"0.7">) {
  const [bundler] = await walletClient.getAddresses();
  const hash = await walletClient.writeContract({ account: bundler!, ...handleOpsArgs([userOp], bundler!) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  const event = parseEventLogs({ abi: entryPoint07Abi, eventName: "UserOperationEvent", logs: receipt.logs }).find(
    (log) => isAddressEqual(log.args.sender, userOp.sender),
  );
  if (!event) throw new Error(`no UserOperationEvent for ${userOp.sender}`);
  return { hash, receipt, event: event.args };
}

async function fund(account: Address) {
  await testClient.setBalance({ address: account, value: parseEther("10") });
  await testClient.setBalance({ address: USDT_HOLDER, value: parseEther("1") });
  await testClient.impersonateAccount({ address: USDT_HOLDER });
  const hash = await walletClient.writeContract({
    account: USDT_HOLDER,
    address: USDT,
    abi: erc20Abi,
    functionName: "transfer",
    args: [account, 5_000_000n],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await testClient.stopImpersonatingAccount({ address: USDT_HOLDER });
}

/** Lowercased addresses of every frame in the transaction's call tree. */
async function calledAddresses(hash: Hash): Promise<string[]> {
  type Frame = { to?: string; calls?: Frame[] };
  const trace = (await publicClient.request({
    method: "debug_traceTransaction",
    params: [hash, { tracer: "callTracer" }],
  } as never)) as Frame;
  const walk = (frame: Frame): string[] => [frame.to?.toLowerCase() ?? "", ...(frame.calls ?? []).flatMap(walk)];
  return walk(trace);
}

describe.each<AccountKind>(["safe", "kernel"])("%s member account", (kind) => {
  const passkey = createFakePasskey();
  let account: SmartAccount;
  let deployHash: Hash;

  beforeAll(async () => {
    account = await toAccount(kind, passkey);
  });

  it("has a deterministic counterfactual address and the expected init code", async () => {
    expect((await toAccount(kind, passkey)).address).toBe(account.address);
    expect((await toAccount(kind, createFakePasskey())).address).not.toBe(account.address);
    expect(await publicClient.getCode({ address: account.address })).toBeUndefined();

    const { factory, factoryData } = await account.getFactoryArgs();
    const data = factoryData!.toLowerCase();
    if (kind === "kernel") {
      expect(factory).toBe(KERNEL_META_FACTORY);
      expect(data).toContain(PATCHED_WEBAUTHN_VALIDATOR);
      for (const unpatched of UNPATCHED_WEBAUTHN_VALIDATORS) expect(data).not.toContain(unpatched);
    } else {
      expect(data).toContain(SAFE_WEBAUTHN_SHARED_SIGNER);
      expect(data).toContain(SAFE_P256_VERIFIERS_WORD);
    }
  });

  it("deploys and runs a tagged batch through EntryPoint v0.7", async () => {
    await fund(account.address); // 5 USDT arrive before the account exists
    const [recipient] = await walletClient.getAddresses();
    const recipientBefore = await usdtBalance(recipient!);
    // The first operation spends part of those funds, so the batch must actually run.
    const calls = [usdtTransfer(recipient!, 1_000_000n), usdtTransfer(recipient!, 1_000_000n)];

    const userOp = await prepare(account, calls);
    expect(userOp.factory).toBeDefined();
    expect(userOp.callData).toBe(concat([await account.encodeCalls(calls), ATTRIBUTION_SUFFIX]));
    userOp.signature = await account.signUserOperation(userOp);

    const { hash, receipt, event } = await sendHandleOps(userOp);
    console.log(`[${kind}] deploy + batch: actualGasUsed=${event.actualGasUsed} handleOps gasUsed=${receipt.gasUsed}`);
    expect(receipt.status).toBe("success");
    expect(event.success).toBe(true);
    expect((await publicClient.getCode({ address: account.address }))?.length).toBeGreaterThan(2);
    expect(await usdtBalance(account.address)).toBe(3_000_000n);
    expect((await usdtBalance(recipient!)) - recipientBefore).toBe(2_000_000n);
    const called = await calledAddresses(hash);
    expect(called).toContain(P256_VERIFIER[kind].toLowerCase());
    // A call to 0x100 shows up in the trace even when it fails, and Safe then verifies through FCL.
    if (kind === "safe") expect(called).not.toContain(SAFE_FCL_VERIFIER.toLowerCase());
    deployHash = hash;
  });

  it("is attributed to this account and no other", async () => {
    expect(await isUserOpAttributed({ client: publicClient, hash: deployHash, sender: account.address })).toBe(true);
    const [bundler] = await walletClient.getAddresses();
    expect(await isUserOpAttributed({ client: publicClient, hash: deployHash, sender: bundler! })).toBe(false);
  });

  it("runs a second tagged operation from the deployed account", async () => {
    const userOp = await prepare(account, [usdtTransfer(account.address, 1n)]);
    expect(userOp.factory).toBeUndefined();
    userOp.signature = await account.signUserOperation(userOp);

    const { hash, receipt, event } = await sendHandleOps(userOp);
    console.log(`[${kind}] second op: actualGasUsed=${event.actualGasUsed} handleOps gasUsed=${receipt.gasUsed}`);
    expect(receipt.status).toBe("success");
    expect(event.success).toBe(true);
    expect(await isUserOpAttributed({ client: publicClient, hash, sender: account.address })).toBe(true);
  });

  it("rejects an operation signed by a different passkey", async () => {
    const impostor = await toAccount(kind, createFakePasskey());
    const userOp = await prepare(account, [usdtTransfer(account.address, 1n)]);
    userOp.signature = await impostor.signUserOperation(userOp); // signs this account's op hash

    const [bundler] = await walletClient.getAddresses();
    await expect(
      publicClient.simulateContract({ account: bundler!, ...handleOpsArgs([userOp], bundler!) }),
    ).rejects.toThrow(/AA24 signature error/);
  });
});
