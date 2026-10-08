// Reads a Celo transaction and prints its ERC-8021 attribution: the verifyTx result and,
// for an EntryPoint handleOps bundle, every UserOperation with its codes. Read-only.
//
// Usage: node scripts/verify-tx.mjs <txHash> [sender] [--code <code>]
//   RPC: https://forno.celo.org, or the CELO_RPC_URL environment variable (never printed).
//   With [sender], prints ATTRIBUTED / NOT ATTRIBUTED / UNKNOWN for that sender and
//   exits 0 / 1 / 2. --code defaults to TesorerIA's celo_fbe4d00a2cb4. Bad arguments exit 64.
import { verifyTx, verifyUserOps } from "@celo/attribution-tags";
import { createPublicClient, http, isAddress, isHash } from "viem";
import { celo } from "viem/chains";

const DEFAULT_CODE = "celo_fbe4d00a2cb4";
const USAGE = `Usage: node scripts/verify-tx.mjs <txHash> [sender] [--code <code>]  (default code: ${DEFAULT_CODE})`;

function parseArgs(argv) {
  const positional = [];
  let code = DEFAULT_CODE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--code") code = argv[++i];
    else if (argv[i].startsWith("--code=")) code = argv[i].slice("--code=".length);
    else positional.push(argv[i]);
  }
  const [hash, sender, ...extra] = positional;
  if (!hash || !isHash(hash)) return { error: `Invalid or missing txHash: ${hash ?? "(none)"}` };
  if (sender !== undefined && !isAddress(sender)) return { error: `Invalid sender address: ${sender}` };
  if (!code) return { error: "--code needs a value" };
  if (extra.length > 0) return { error: `Unexpected arguments: ${extra.join(" ")}` };
  return { hash, sender, code };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`${args.error}\n${USAGE}`);
    return 64;
  }
  const { hash, sender, code } = args;
  const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
  const client = createPublicClient({ chain: celo, transport: http(rpcUrl) });
  console.log(`Transaction: ${hash}`);
  // A custom endpoint usually carries an API key in its path or query: never print it.
  console.log(process.env.CELO_RPC_URL === undefined ? `RPC: ${rpcUrl}` : "RPC: custom endpoint from CELO_RPC_URL");

  const first = await verifyTx({ client, hash });
  if (first) {
    const by = first.sender ? ` (UserOperation sender ${first.sender})` : "";
    console.log(`verifyTx: codes=${first.codes.join(",")} schema=${first.schemaId}${by}`);
  } else {
    console.log("verifyTx: no attribution found, or the transaction could not be read");
  }

  const userOps = await verifyUserOps({ client, hash });
  if (userOps === null) {
    console.log("verifyUserOps: not an EntryPoint handleOps bundle, or the transaction could not be read");
  } else {
    console.log(`verifyUserOps: ${userOps.length} UserOperation(s)`);
    userOps.forEach((op, i) => {
      const tag = op.attribution ? `codes=${op.attribution.codes.join(",")}` : "untagged";
      console.log(`  #${i} sender=${op.sender} ${tag}`);
    });
  }

  if (sender === undefined) return 0;
  if (userOps === null) {
    console.log(
      `UNKNOWN: no readable bundle, so ${sender} cannot be checked for ${code} ` +
        "(make sure this is the bundle transaction hash, not the UserOperation hash; " +
        "a just-mined transaction may need a few seconds to be indexed)",
    );
    return 2;
  }
  const attributed = userOps.some(
    (op) => op.sender.toLowerCase() === sender.toLowerCase() && (op.attribution?.codes.includes(code) ?? false),
  );
  console.log(attributed ? `ATTRIBUTED: ${sender} has ${code}` : `NOT ATTRIBUTED: no operation from ${sender} has ${code}`);
  return attributed ? 0 : 1;
}

// An unexpected throw must not exit 1 (NOT ATTRIBUTED) or print a message or stack that could carry the RPC URL.
process.exitCode = await main().catch((error) => {
  console.log(`UNKNOWN: unexpected error (${error instanceof Error ? error.name : typeof error})`);
  return 2;
});
