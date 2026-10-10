// Shared by the test and by serve.ts, which Node runs as is: so nothing here may import the workspace packages
// (their TypeScript imports have no extensions), and the addresses are repeated from @tesoreria/agent. A unit
// test (test/e2e-addresses.test.ts) checks they are the same. Playwright comes in for its types only.
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { type Address, createPublicClient, createTestClient, createWalletClient, erc20Abi, http, parseEther } from "viem";
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
 * before React hydrates the page does nothing (a form even goes out as the browser's own GET), so it waits
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
