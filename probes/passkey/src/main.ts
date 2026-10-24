import {
  type Call,
  type SendTaggedCallsResult,
  createMemberAccount,
  createPimlicoBundlerClient,
  isSafeKey,
  isUserOpAttributed,
  pimlicoTransport,
  readSafeKey,
  sendKeyChange,
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
// "Change key": the new passkey until the Safe holds its key, and the one it replaced, kept rather than dropped.
const PENDING_KEY = "tesoreria-probe-pending-credential";
const PREVIOUS_KEY = "tesoreria-probe-previous-credential";

/** `address` is set once the key changed: the new key no longer gives the Safe's address. */
type StoredCredential = { id: string; publicKey: Hex; address?: Address };

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
let account: SmartAccount | undefined;
let lastOperation: { hash: Hash; sender: Address } | undefined;

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, text: string) => (element(id).textContent = text);
const accountButtons = ["refresh", "send-test", "return", "change-key"];
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

function loadCredential(key = STORAGE_KEY): StoredCredential | undefined {
  const saved = localStorage.getItem(key);
  return saved ? (JSON.parse(saved) as StoredCredential) : undefined;
}

async function connect(credential: StoredCredential) {
  // A second passkey would replace the stored one, and with it the Safe that holds the funds.
  lockButton("create");
  setText("credential", credential.id);
  setText("public-key", credential.publicKey);
  setText("pending", loadCredential(PENDING_KEY)?.id ?? "none");
  const { id, publicKey, address } = credential;
  account = await createMemberAccount({
    client,
    owner: toWebAuthnAccount({ credential: { id, publicKey } }),
    ...(address === undefined ? {} : { address }),
  });
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

function bundlerClient() {
  const apiKey = import.meta.env.VITE_PIMLICO_API_KEY;
  const sponsorshipPolicyId = import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID;
  if (!apiKey || !sponsorshipPolicyId)
    throw new Error("Set VITE_PIMLICO_API_KEY and VITE_PIMLICO_SPONSORSHIP_POLICY_ID in .env.local.");
  return createPimlicoBundlerClient({ client, transport: pimlicoTransport(apiKey), sponsorshipPolicyId });
}

async function send(calls: Call[]) {
  const sender = requireAccount();
  const bundler = bundlerClient();
  for (const id of ["user-op-hash", "transaction", "success", "attributed"]) setText(id, "…");
  await showResult(await sendTaggedCalls({ bundlerClient: bundler, account: sender, calls }), sender);
}

async function showResult(result: SendTaggedCallsResult, sender: SmartAccount) {
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

// The new passkey is stored as pending before the swap goes out, so a page closed halfway can't lose it: the next
// "Change key" reuses it, and makes it the current one as soon as the Safe holds its key.
onClick("change-key", async () => {
  const current = loadCredential();
  if (!current) throw new Error("Create a passkey first.");
  const sender = requireAccount();
  const bundler = bundlerClient();
  let pending = loadCredential(PENDING_KEY);
  if (pending && isSafeKey(await readSafeKey(client, sender.address), pending.publicKey)) return promote(current, pending);
  if (!pending) {
    const name = `TesorerIA probe ${new Date().toISOString()}`; // a random user handle, as in "Create passkey"
    const { id, publicKey } = await createWebAuthnCredential({
      name,
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name },
    });
    pending = { id, publicKey, address: sender.address };
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    setText("pending", id);
  }
  for (const id of ["user-op-hash", "transaction", "success", "attributed"]) setText(id, "…");
  await showResult(await sendKeyChange({ bundlerClient: bundler, account: sender, publicKey: pending.publicKey }), sender);
  if (!isSafeKey(await readSafeKey(client, sender.address), pending.publicKey))
    throw new Error("The Safe doesn't show the new key yet. Press Change key again to check: it reuses the pending passkey.");
  await promote(current, pending);
});

async function promote(current: StoredCredential, pending: StoredCredential) {
  localStorage.setItem(PREVIOUS_KEY, JSON.stringify({ ...current, address: pending.address }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  localStorage.removeItem(PENDING_KEY);
  await connect(pending);
}

const saved = loadCredential();
if (saved) connect(saved).catch(showError);
