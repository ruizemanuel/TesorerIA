import {
  type Call,
  createMemberAccount,
  createPimlicoBundlerClient,
  isUserOpAttributed,
  pimlicoTransport,
  sendTaggedCalls,
} from "@tesoreria/wallet";
import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseUnits,
} from "viem";
import { type SmartAccount, createWebAuthnCredential, toWebAuthnAccount } from "viem/account-abstraction";
import { celo } from "viem/chains";

const USDT: Address = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"; // 6 decimals
const WARS: Address = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"; // 18 decimals
// Tokens the "Return tokens" section can send; the keys are the <select> option values.
const TOKENS = {
  usdt: { address: USDT, decimals: 6 },
  wars: { address: WARS, decimals: 18 },
} as const;
const STORAGE_KEY = "tesoreria-probe-credential";

type StoredCredential = { id: string; publicKey: Hex };

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
let account: SmartAccount | undefined;
let lastOperation: { hash: Hash; sender: Address } | undefined;

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, text: string) => (element(id).textContent = text);
const accountButtons = ["refresh", "send-test", "return"];
const lockedButtons = new Set<string>(); // stay disabled after their action finishes

function showError(error: unknown) {
  setText("error", error instanceof Error ? error.message : String(error));
}

function lockButton(id: string) {
  lockedButtons.add(id);
  element<HTMLButtonElement>(id).disabled = true;
}

function onClick(id: string, action: () => Promise<void>) {
  const button = element<HTMLButtonElement>(id);
  button.addEventListener("click", async () => {
    setText("error", "");
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = lockedButtons.has(id);
    }
  });
}

function loadCredential(): StoredCredential | undefined {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? (JSON.parse(saved) as StoredCredential) : undefined;
}

async function connect(credential: StoredCredential) {
  // A second passkey would replace the stored one, and with it the Safe that holds the funds.
  lockButton("create");
  setText("credential", credential.id);
  setText("public-key", credential.publicKey);
  account = await createMemberAccount({ client, owner: toWebAuthnAccount({ credential }) });
  setText("address", account.address);
  for (const id of accountButtons) element<HTMLButtonElement>(id).disabled = false;
  await refresh();
}

function requireAccount(): SmartAccount {
  if (!account) throw new Error("Create a passkey first.");
  return account;
}

async function balanceOf(token: Address, owner: Address) {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

async function refresh() {
  const { address } = requireAccount();
  const [deployed, usdt, wars] = await Promise.all([
    requireAccount().isDeployed(),
    balanceOf(USDT, address),
    balanceOf(WARS, address),
  ]);
  setText("deployed", deployed ? "yes" : "no (deployed by the first operation)");
  setText("usdt", formatUnits(usdt, 6));
  setText("wars", formatUnits(wars, 18));
}

function tokenTransfer(token: Address, to: Address, amount: bigint): Call {
  return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) };
}

async function checkAttribution() {
  if (!lastOperation) throw new Error("Send an operation first.");
  setText("attributed", "…");
  const attributed = await isUserOpAttributed({ client, ...lastOperation });
  setText("attributed", attributed === null ? "unknown (retry)" : attributed ? "yes" : "NO");
}

async function send(calls: Call[]) {
  const apiKey = import.meta.env.VITE_PIMLICO_API_KEY;
  const sponsorshipPolicyId = import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID;
  if (!apiKey || !sponsorshipPolicyId)
    throw new Error("Set VITE_PIMLICO_API_KEY and VITE_PIMLICO_SPONSORSHIP_POLICY_ID in .env.local.");

  const sender = requireAccount();
  for (const id of ["user-op-hash", "transaction", "success", "attributed"]) setText(id, "…");
  const bundlerClient = createPimlicoBundlerClient({ client, transport: pimlicoTransport(apiKey), sponsorshipPolicyId });
  const result = await sendTaggedCalls({ bundlerClient, account: sender, calls });

  setText("user-op-hash", result.userOpHash);
  const link = element<HTMLAnchorElement>("transaction");
  link.href = `https://celoscan.io/tx/${result.transactionHash}`;
  link.textContent = result.transactionHash;
  setText("success", result.success ? "yes" : `NO (reason: ${result.reason ?? "none"})`);
  lastOperation = { hash: result.transactionHash, sender: sender.address };
  element<HTMLButtonElement>("check-again").disabled = false;
  await checkAttribution();
  await refresh();
}

onClick("create", async () => {
  // Re-read the storage: another tab may have created a passkey since this page loaded.
  if (loadCredential())
    throw new Error("A passkey is already stored in this browser. Reload the page to use it instead of creating another.");
  // A random user handle per passkey: ox derives it from the name by default, and an authenticator
  // replaces the earlier discoverable credential of the same site and user handle, which would
  // destroy the key behind a funded Safe. The name carries the time to tell passkeys apart.
  const name = `TesorerIA probe ${new Date().toISOString()}`;
  const { id, publicKey } = await createWebAuthnCredential({
    name,
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name },
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, publicKey } satisfies StoredCredential));
  await connect({ id, publicKey });
});

onClick("refresh", refresh);
onClick("check-again", checkAttribution);

onClick("send-test", async () => {
  const self = requireAccount().address;
  await send([tokenTransfer(USDT, self, 1n), tokenTransfer(USDT, self, 1n)]);
});

onClick("return", async () => {
  const token = TOKENS[element<HTMLSelectElement>("token").value as keyof typeof TOKENS];
  const destination = element<HTMLInputElement>("destination").value.trim();
  // Accepts all-lowercase addresses; rejects mixed case with a wrong checksum (likely a typo).
  if (!isAddress(destination)) throw new Error("Destination is not a valid address.");
  const amount = parseUnits(element<HTMLInputElement>("amount").value.trim(), token.decimals);
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  await send([tokenTransfer(token.address, destination, amount)]);
});

const saved = loadCredential();
if (saved) connect(saved).catch(showError);
