// Shared by the test and by serve.ts, which Node runs as is: so nothing here may import the workspace packages
// (their TypeScript imports have no extensions), and the addresses are repeated from @tesoreria/agent. A unit
// test (test/e2e-addresses.test.ts) checks they are the same. Playwright comes in for its types only.
import type { BrowserContext, Locator, Page } from "@playwright/test";
import {
  type Address,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  erc20Abi,
  getAbiItem,
  getContract,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { entryPoint07Abi, entryPoint07Address } from "viem/account-abstraction";
import { celo } from "viem/chains";

export const FORK_PORT = 8548;
export const FORK_RPC = `http://127.0.0.1:${FORK_PORT}`;
const transport = http(FORK_RPC);
const client = createPublicClient({ chain: celo, transport });
const test = createTestClient({ chain: celo, mode: "anvil", transport });
const wallet = createWalletClient({ chain: celo, transport });
export const POOL: Address = "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391"; // Uniswap's wARS/USDT pool: it holds both
export const USDT: Address = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
export const WARS: Address = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";

/**
 * The heartbeat's secret on the fork: serve.ts gives it to the web, and the test calls the heartbeat with it. Only
 * for this local fork, which nobody else reaches.
 */
export const HEARTBEAT_SECRET = "e2e-heartbeat-secret-on-the-local-fork-only-0000000000000000000";

/** Moves the fork's clock `seconds` ahead and mines a block on it: how a week ends on the fork (spec, 9.4). */
export async function advanceClock(seconds: number): Promise<void> {
  await test.increaseTime({ seconds });
  await test.mine({ blocks: 1 });
}

/** A person's phone: a page with a virtual platform authenticator that verifies the user (CDP, Chromium only). */
export async function phone(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return page;
}

/**
 * Opens `url` once the page answers to taps. `next dev` sends the HTML before its scripts, and a tap that lands
 * before React hydrates the page is lost (a form goes out as the browser's own POST and comes back empty), so it waits
 * until no request has been made for half a second.
 */
export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });
}

/** The logged-in person's account, from the web's own /api/me. */
export async function accountOf(page: Page): Promise<Address> {
  const me = (await (await page.request.get("/api/me")).json()) as { account: Address };
  return me.account;
}

/**
 * Text on screen: the inicio has a phone timeline and a desktop one in the page, and hides one of them for the
 * width, so the same sentence can be there twice.
 */
export function onScreen(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true });
}

/** CELO for a Safe's gas on the fork (no paymaster), and tokens from the pool, which holds both. */
export async function give(account: Address, { usdt = 0n, wars = 0n }: { usdt?: bigint; wars?: bigint } = {}) {
  await test.setBalance({ address: account, value: parseEther("10") });
  await test.setBalance({ address: POOL, value: parseEther("1") });
  await test.impersonateAccount({ address: POOL });
  for (const [token, amount] of [
    [USDT, usdt],
    [WARS, wars],
  ] as const) {
    if (amount === 0n) continue;
    const hash = await wallet.writeContract({ account: POOL, address: token, abi: erc20Abi, functionName: "transfer", args: [account, amount] });
    await client.waitForTransactionReceipt({ hash });
  }
  await test.stopImpersonatingAccount({ address: POOL });
}

/** The wARS `account` holds on the fork. */
export async function warsOf(account: Address): Promise<bigint> {
  return client.readContract({ address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [account] });
}

/** The USDT `account` holds on the fork. */
export async function usdtOf(account: Address): Promise<bigint> {
  return client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account] });
}

/** The parts of FundV2 (contracts/src/FundV2.sol) the test reads, and calls the web doesn't offer. */
export const fundV2Abi = parseAbi([
  "function currency() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function pendingDollar(address member) view returns (uint256)",
  "function proposalCount() view returns (uint256)",
  "function propose(uint8 action, address a, address b, uint256 amount, string note) returns (uint256 id)",
  "function vote(uint256 id)",
  "function execute(uint256 id)",
]);

/** The FundV2 at `fund` on the fork, to read: `fundV2(fund).read.feeBps()`. */
export function fundV2(fund: Address) {
  return getContract({ address: fund, abi: fundV2Abi, client });
}

/**
 * Sends `data` to `to` from `account`, a member's Safe, impersonated on the fork and given CELO for the gas: a call the
 * web doesn't offer, as the member would make it from any wallet. Throws if it reverts.
 */
export async function asAccount(account: Address, to: Address, data: Hex): Promise<void> {
  await test.setBalance({ address: account, value: parseEther("10") });
  await test.impersonateAccount({ address: account });
  try {
    const hash = await wallet.sendTransaction({ account, to, data });
    const { status } = await client.waitForTransactionReceipt({ hash });
    if (status !== "success") throw new Error(`The call from ${account} to ${to} reverted: ${hash}`);
  } finally {
    await test.stopImpersonatingAccount({ address: account });
  }
}

/** The fork's latest block. */
export async function latestBlock(): Promise<bigint> {
  return client.getBlockNumber({ cacheTime: 0 });
}

const userOperationEvent = getAbiItem({ abi: entryPoint07Abi, name: "UserOperationEvent" });

/**
 * The gas each operation `account` sent from `fromBlock` on used, oldest first: the gasUsed of the handleOps transaction
 * that ran it, which the fork bundler sends with that operation alone.
 */
export async function operationsGas(account: Address, fromBlock: bigint): Promise<bigint[]> {
  const logs = await client.getLogs({ address: entryPoint07Address, event: userOperationEvent, args: { sender: account }, fromBlock });
  return Promise.all(logs.map(async ({ transactionHash }) => (await client.getTransactionReceipt({ hash: transactionHash })).gasUsed));
}
