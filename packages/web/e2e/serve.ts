// The web against an anvil fork of Celo: anvil on 8548, a throwaway agent, and `next dev` on 3000 with the
// fork bundler and an in-memory database. For the end-to-end test, and for looking at the web by hand.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { celo } from "viem/chains";
import { FORK_PORT, FORK_RPC, HEARTBEAT_SECRET, give } from "./support.ts";

const WEB_PORT = 3000;
const FORK_URLS = (process.env.FORK_URLS ?? "https://forno.celo.org,https://celo-rpc.publicnode.com").split(",");
const ANVIL = process.env.ANVIL_BIN ?? join(homedir(), ".foundry", "bin", process.platform === "win32" ? "anvil.exe" : "anvil");

/** Whether something already answers on `port`, on either loopback address. */
async function inUse(port: number): Promise<boolean> {
  const answers = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ host, port });
      socket.setTimeout(2_000, () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
  return (await Promise.all(["127.0.0.1", "::1"].map(answers))).some(Boolean);
}

for (const [port, what] of [
  [FORK_PORT, "anvil"],
  [WEB_PORT, "next dev"],
] as const) {
  if (await inUse(port)) {
    console.error(`Port ${port} (for ${what}) is already in use: stop whatever runs there first.`);
    process.exit(1);
  }
}

// Whatever ends this process ends anvil and next too. On Windows kill() stops only the process itself, and
// next dev leaves its workers running, so the whole tree goes with taskkill.
const children: ChildProcess[] = [];
process.on("exit", () => {
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill();
  }
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

// A block every second, like Celo, besides one for each transaction. viem waits for a receipt by watching for new
// blocks, so on an anvil that only mines transactions a wait that missed its block hangs until the next one: the
// agent's and the fork bundler's waits did, now and then, until the browser gave up.
const anvil = spawn(
  ANVIL,
  [
    ...FORK_URLS.flatMap((url) => ["--fork-url", url]),
    "--timeout", "10000",
    "--port", String(FORK_PORT),
    "--block-time", "1", "--mixed-mining",
    "--silent",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
children.push(anvil);
const client = createPublicClient({ chain: celo, transport: http(FORK_RPC) });
for (let tries = 0; ; tries++) {
  try {
    await client.getChainId();
    break;
  } catch (error) {
    if (anvil.exitCode !== null) throw new Error(`anvil exited with code ${anvil.exitCode}`, { cause: error });
    if (tries > 240) throw new Error("anvil did not start within 60 s", { cause: error });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// The agent: a throwaway key, with CELO for its gas (the fork signer pays in CELO) and USDT, which act() checks it holds.
const agentKey = generatePrivateKey();
const agent = privateKeyToAddress(agentKey);
await give(agent, { usdt: 5_000_000n });
console.log(`Celo fork on ${FORK_RPC}; the agent is ${agent}.`);

// Next's own binary, run by this Node: no shell in between, so the process tree above is the whole of it.
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const next = spawn(process.execPath, [nextBin, "dev", "--port", String(WEB_PORT)], {
  stdio: "inherit",
  env: {
    ...process.env,
    CHAIN_MODE: "fork",
    RP_ID: "localhost",
    ORIGIN: `http://localhost:${WEB_PORT}`,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    DATABASE_URL: "memory",
    CELO_RPC_URL: FORK_RPC,
    NEXT_PUBLIC_CELO_RPC_URL: FORK_RPC,
    BASE_RPC_URL: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    AGENT_PRIVATE_KEY: agentKey,
    // The kill switch, on: on the fork the agent sends (the deployed default is off).
    AGENT_SEND: "on",
    // Known to the test, which calls the heartbeat to close a week (fund.spec, step 13).
    HEARTBEAT_SECRET,
    // The chat, with the scripted model: the real one is never asked from a test (spec, 11).
    CHAT_MODEL: "mock",
  },
});
children.push(next);
next.on("exit", (code) => process.exit(code ?? 0));
anvil.on("exit", () => {
  console.error("anvil stopped: stopping the web too.");
  process.exit(1);
});
