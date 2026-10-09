import { spawn } from "node:child_process";
import { once } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";

// Not @tesoreria/wallet's 8546, so both packages' fork tests can run at the same time.
export const ANVIL_PORT = 8547;
export const ANVIL_RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;

// Two endpoints: anvil round-robins between them and rotates to the other one on failure.
const FORK_URLS = (process.env.FORK_URLS ?? "https://forno.celo.org,https://celo-rpc.publicnode.com").split(",");
const ANVIL_BIN =
  process.env.ANVIL_BIN ??
  join(homedir(), ".foundry", "bin", process.platform === "win32" ? "anvil.exe" : "anvil");

async function isUp(): Promise<boolean> {
  try {
    const response = await fetch(ANVIL_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Vitest global setup: forks Celo mainnet into a local anvil and stops it afterwards. */
export default async function setup() {
  if (await isUp()) throw new Error(`Port ${ANVIL_PORT} is already in use; stop that node first.`);

  const anvil = spawn(
    ANVIL_BIN,
    [
      ...FORK_URLS.flatMap((url) => ["--fork-url", url]),
      "--timeout", "10000", // per remote request (default 45 s); a stalled endpoint fails over sooner
      "--port", String(ANVIL_PORT),
      "--silent", // keeps anvil's dev-account banner out of the test output
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  anvil.stderr.on("data", (chunk) => (stderr += chunk));

  const deadline = Date.now() + 60_000;
  while (!(await isUp())) {
    if (anvil.exitCode !== null) throw new Error(`anvil exited early: ${stderr}`);
    if (Date.now() > deadline) {
      anvil.kill();
      throw new Error(`anvil did not start within 60 s: ${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return async () => {
    if (anvil.exitCode !== null) return;
    anvil.kill();
    await once(anvil, "exit");
  };
}
