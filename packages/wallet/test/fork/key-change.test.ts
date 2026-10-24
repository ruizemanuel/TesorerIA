import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  http,
  parseEther,
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
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_SUFFIX,
  type Call,
  SAFE_P256_VERIFIERS,
  createMemberAccount,
  createPimlicoBundlerClient,
  isSafeKey,
  isUserOpAttributed,
  readSafeKey,
  sendKeyChange,
  sendTaggedCalls,
} from "../../src";
import { createForkBundler } from "../../src/fork";
import { ANVIL_RPC_URL } from "../support/anvil.globalSetup";
import { createFakePasskey } from "../support/fakePasskey";

const USDT: Address = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const USDT_HOLDER: Address = "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391"; // wARS/USDT pool, impersonated
const ONE_USDT = 1_000_000n;

const OLD_RP_ID = "tesoreriaia.vercel.app";
const NEW_RP_ID = "tesoreria.finance";
const ORIGIN = "https://tesoreria.finance";

const transport = http(ANVIL_RPC_URL);
const publicClient = createPublicClient({ chain: celo, transport });
const testClient = createTestClient({ chain: celo, mode: "anvil", transport });
const walletClient = createWalletClient({ chain: celo, transport });

/** The web's own bundler client, pointed at the fork bundler instead of Pimlico. */
function webBundlerClient() {
  return createPimlicoBundlerClient({
    client: publicClient,
    transport: custom(createForkBundler({ rpcUrl: ANVIL_RPC_URL })),
    sponsorshipPolicyId: "ignored on the fork",
  });
}

/** What a member of the old site and the same person on the new one hold: two passkeys, on two RP IDs. */
function passkeys() {
  const old = createFakePasskey({ rpId: OLD_RP_ID, origin: ORIGIN });
  const fresh = createFakePasskey({ rpId: NEW_RP_ID, origin: ORIGIN });
  return {
    old,
    fresh,
    oldOwner: toWebAuthnAccount({ ...old, rpId: OLD_RP_ID }),
    freshOwner: toWebAuthnAccount({ ...fresh, rpId: NEW_RP_ID }),
  };
}

/** CELO for gas (the fork bundler has no paymaster) and 5 USDT from the impersonated holder. */
async function fund(account: Address) {
  await testClient.setBalance({ address: account, value: parseEther("10") });
  await testClient.setBalance({ address: USDT_HOLDER, value: parseEther("1") });
  await testClient.impersonateAccount({ address: USDT_HOLDER });
  const hash = await walletClient.writeContract({
    account: USDT_HOLDER,
    address: USDT,
    abi: erc20Abi,
    functionName: "transfer",
    args: [account, 5n * ONE_USDT],
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  await testClient.stopImpersonatingAccount({ address: USDT_HOLDER });
}

const usdtOf = (account: Address) =>
  publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account] });

const transferOneUsdt = (to: Address) => ({
  to: USDT,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, ONE_USDT] }),
});

/**
 * What the EntryPoint says to a bundle with one operation of `account`, signed with its passkey. The fork bundler only
 * reports a bundle that reverted as having no UserOperationEvent, so the reason (FailedOp, AAxx) is read from a simulation.
 */
async function simulateHandleOps(bundlerClient: ReturnType<typeof webBundlerClient>, account: SmartAccount, call: Call) {
  const prepared = (await bundlerClient.prepareUserOperation({
    account,
    calls: [call],
    dataSuffix: ATTRIBUTION_SUFFIX,
  })) as unknown as UserOperation<"0.7">;
  const userOperation: UserOperation<"0.7"> = { ...prepared, signature: await account.signUserOperation(prepared) };
  const [executor] = (await walletClient.getAddresses()) as [Address];
  return publicClient.simulateContract({
    account: executor,
    address: entryPoint07Address,
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [[toPackedUserOperation(userOperation)], executor],
  });
}

describe("changing a Safe's passkey in place", () => {
  it("changes a deployed Safe's key in place", async () => {
    const { old, fresh, oldOwner, freshOwner } = passkeys();
    const account = await createMemberAccount({ client: publicClient, owner: oldOwner });
    await fund(account.address);
    const bundlerClient = webBundlerClient();
    const [recipient] = (await walletClient.getAddresses()) as [Address];

    // The Safe exists, with the old passkey as its owner.
    const deployed = await sendTaggedCalls({
      bundlerClient,
      account,
      calls: [{ to: USDT, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [recipient, 0n] }) }],
    });
    expect(deployed.success).toBe(true);
    expect(isSafeKey(await readSafeKey(publicClient, account.address), old.credential.publicKey)).toBe(true);
    const before = await usdtOf(account.address);

    // The old passkey signs the change to the new one.
    const change = await sendKeyChange({ bundlerClient, account, publicKey: fresh.credential.publicKey });
    expect(change.success).toBe(true);
    expect(await isUserOpAttributed({ client: publicClient, hash: change.transactionHash, sender: account.address })).toBe(true);
    const key = await readSafeKey(publicClient, account.address);
    expect(isSafeKey(key, fresh.credential.publicKey)).toBe(true);
    expect(isSafeKey(key, old.credential.publicKey)).toBe(false);
    expect(key.verifiers).toBe(BigInt(SAFE_P256_VERIFIERS));

    // The new passkey now moves the funds, from the same address.
    const renewed = await createMemberAccount({ client: publicClient, owner: freshOwner, address: account.address });
    expect(renewed.address).toBe(account.address);
    const sent = await sendTaggedCalls({ bundlerClient, account: renewed, calls: [transferOneUsdt(recipient)] });
    expect(sent.success).toBe(true);

    // The old one no longer does: the EntryPoint rejects its signature.
    const stale = await createMemberAccount({ client: publicClient, owner: oldOwner, address: account.address });
    await expect(simulateHandleOps(bundlerClient, renewed, transferOneUsdt(recipient))).resolves.toBeDefined();
    await expect(simulateHandleOps(bundlerClient, stale, transferOneUsdt(recipient))).rejects.toThrow(/AA24/);
    await expect(sendTaggedCalls({ bundlerClient, account: stale, calls: [transferOneUsdt(recipient)] })).rejects.toThrow();

    expect(await usdtOf(account.address)).toBe(before - ONE_USDT);
  });

  it("changes the key of a Safe that was never deployed, in the operation that deploys it", async () => {
    const { old, fresh, oldOwner, freshOwner } = passkeys();
    const account = await createMemberAccount({ client: publicClient, owner: oldOwner });
    await fund(account.address);
    const bundlerClient = webBundlerClient();
    const [recipient] = (await walletClient.getAddresses()) as [Address];

    expect(await publicClient.getCode({ address: account.address })).toBeUndefined();
    expect(await readSafeKey(publicClient, account.address)).toEqual({ x: 0n, y: 0n, verifiers: 0n });

    // The old passkey signs the operation that deploys the Safe with its key, and the same operation swaps it.
    const change = await sendKeyChange({ bundlerClient, account, publicKey: fresh.credential.publicKey });
    expect(change.success).toBe(true);
    expect((await publicClient.getCode({ address: account.address }))?.length).toBeGreaterThan(2);
    const key = await readSafeKey(publicClient, account.address);
    expect(isSafeKey(key, fresh.credential.publicKey)).toBe(true);
    expect(isSafeKey(key, old.credential.publicKey)).toBe(false);

    const renewed = await createMemberAccount({ client: publicClient, owner: freshOwner, address: account.address });
    expect(renewed.address).toBe(account.address);
    const sent = await sendTaggedCalls({ bundlerClient, account: renewed, calls: [transferOneUsdt(recipient)] });
    expect(sent.success).toBe(true);
    expect(await usdtOf(account.address)).toBe(4n * ONE_USDT);
  });
});
