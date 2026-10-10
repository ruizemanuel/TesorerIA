import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { describe, expect, it } from "vitest";
import { createMemberAccount, createPimlicoBundlerClient, isUserOpAttributed, sendTaggedCalls } from "../../src";
import { createForkBundler } from "../../src/fork";
import { ANVIL_RPC_URL } from "../support/anvil.globalSetup";
import { createFakePasskey } from "../support/fakePasskey";

const USDT: Address = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const USDT_HOLDER: Address = "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391"; // wARS/USDT pool, impersonated
// TesorerIA's deployed FundFactory (the same address as FUND_FACTORY in @tesoreria/agent, which depends on this
// package and so can't be imported here).
const FUND_FACTORY: Address = "0xdF3B0d9edCA58Aac7c9Db4F2931f3559daf82020";
const fundFactoryAbi = parseAbi([
  "function fundCount() view returns (uint256)",
  "function createFund((string name, address[] members, uint8 votesRequired, address agent, string agreedExpense, uint256 weeklyCap, uint256 balanceCap) p) returns (address fund)",
  "event FundCreated(address indexed fund, address indexed creator, string name)",
]);

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

describe("the fork bundler", () => {
  it("runs the web's own bundler path: deploys a member's Safe and sends a tagged batch", async () => {
    const owner = toWebAuthnAccount({ ...createFakePasskey(), rpId: "localhost" });
    const account = await createMemberAccount({ client: publicClient, owner });
    await testClient.setBalance({ address: account.address, value: parseEther("10") });
    await testClient.setBalance({ address: USDT_HOLDER, value: parseEther("1") });
    await testClient.impersonateAccount({ address: USDT_HOLDER });
    const funding = await walletClient.writeContract({
      account: USDT_HOLDER,
      address: USDT,
      abi: erc20Abi,
      functionName: "transfer",
      args: [account.address, 5_000_000n],
    });
    await publicClient.waitForTransactionReceipt({ hash: funding, timeout: 60_000 });
    await testClient.stopImpersonatingAccount({ address: USDT_HOLDER });

    const bundlerClient = webBundlerClient();
    const [recipient] = (await walletClient.getAddresses()) as [Address];
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 1_000_000n] });
    const result = await sendTaggedCalls({ bundlerClient, account, calls: [{ to: USDT, data }, { to: USDT, data }] });

    expect(result.success).toBe(true);
    const left = await publicClient.readContract({
      address: USDT,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    expect(left).toBe(3_000_000n);
    expect(await isUserOpAttributed({ client: publicClient, hash: result.transactionHash, sender: account.address })).toBe(true);
  });

  it("has gas for the creator's first operation: deploys the Safe and a whole fund with FundFactory.createFund", async () => {
    const owner = toWebAuthnAccount({ ...createFakePasskey(), rpId: "localhost" });
    const account = await createMemberAccount({ client: publicClient, owner });
    await testClient.setBalance({ address: account.address, value: parseEther("10") }); // what the web's fork accounts get
    const members = [account.address, ...[1, 2].map(() => privateKeyToAddress(generatePrivateKey()))];
    const before = await publicClient.readContract({ address: FUND_FACTORY, abi: fundFactoryAbi, functionName: "fundCount" });

    const data = encodeFunctionData({
      abi: fundFactoryAbi,
      functionName: "createFund",
      args: [
        {
          name: "Fork bundler",
          members,
          votesRequired: 2,
          agent: privateKeyToAddress(generatePrivateKey()),
          agreedExpense: "Pitch",
          weeklyCap: parseUnits("100000", 18),
          balanceCap: parseUnits("450000", 18),
        },
      ],
    });
    const result = await sendTaggedCalls({ bundlerClient: webBundlerClient(), account, calls: [{ to: FUND_FACTORY, data }] });

    expect(result.success).toBe(true);
    const receipt = await publicClient.getTransactionReceipt({ hash: result.transactionHash });
    const created = parseEventLogs({ abi: fundFactoryAbi, eventName: "FundCreated", logs: receipt.logs });
    expect(created).toHaveLength(1);
    expect(created[0]?.args.creator).toBe(account.address);
    const fund = created[0]?.args.fund as Address;
    const code = await publicClient.getCode({ address: fund });
    expect(code?.length).toBeGreaterThan(2 + 2 * 10_000); // the ~14.7 KB runtime, not an empty account
    expect(await publicClient.readContract({ address: FUND_FACTORY, abi: fundFactoryAbi, functionName: "fundCount" })).toBe(
      before + 1n,
    );
  });

  it("answers null for a UserOperation it never saw, and refuses methods it doesn't know", async () => {
    const bundler = createForkBundler({ rpcUrl: ANVIL_RPC_URL });
    const unknown = `0x${"00".repeat(32)}`;
    expect(await bundler.request({ method: "eth_getUserOperationReceipt", params: [unknown] })).toBeNull();
    await expect(bundler.request({ method: "eth_sendRawTransaction" })).rejects.toThrow("not supported");
  });
});
