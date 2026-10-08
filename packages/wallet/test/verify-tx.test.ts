import { toDataSuffix } from "@celo/attribution-tags";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { type Address, type Hash, type Hex, concat, encodeFunctionData, erc20Abi, getAddress } from "viem";
import { type UserOperation, entryPoint07Abi, entryPoint07Address, toPackedUserOperation } from "viem/account-abstraction";
import { describe, expect, it } from "vitest";
import { ATTRIBUTION_CODE, ATTRIBUTION_SUFFIX } from "../src";

const OURS = getAddress("0x5a6b47f4131bf1feafa56a05573314bcf44c9149");
const OTHER = getAddress("0x2be9a1b6de16bd7dec13d5aa6e3c8a5c8be1f2a7");
const BUNDLER = getAddress("0x4337000c2828f5260d8921fd25829f606b9e8680");
const HASH: Hash = `0x${"ab".repeat(32)}`;
const OTHER_SUFFIX = toDataSuffix("celo_other");
// Stands in for a provider URL with an API key in its path: it must never be printed.
const SECRET_PATH = "/v2/s3cret-key-8f3a1c";
const RPC_LINE = "RPC: custom endpoint from CELO_RPC_URL";

const PACKAGE_DIR = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(PACKAGE_DIR, "scripts/verify-tx.mjs");

function userOp(sender: Address, suffix: Hex): UserOperation<"0.7"> {
  return {
    sender,
    nonce: 0n,
    callData: concat([encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [sender, 1n] }), suffix]),
    callGasLimit: 100_000n,
    verificationGasLimit: 500_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    signature: `0x${"11".repeat(65)}`,
  };
}

/** A handleOps transaction in the JSON-RPC shape: another project's tagged operation first, then ours. */
function sharedBundle() {
  const input = encodeFunctionData({
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [[userOp(OTHER, OTHER_SUFFIX), userOp(OURS, ATTRIBUTION_SUFFIX)].map((op) => toPackedUserOperation(op)), BUNDLER],
  });
  return {
    hash: HASH,
    from: BUNDLER,
    to: entryPoint07Address,
    input,
    nonce: "0x1",
    gas: "0x7a120",
    gasPrice: "0x6fc23ac00",
    value: "0x0",
    type: "0x0",
    blockHash: `0x${"ef".repeat(32)}`,
    blockNumber: "0x4be61b6",
    transactionIndex: "0x0",
  };
}

type Run = { code: number; stdout: string; stderr: string; port: number; requests: string[]; unexpected: string[] };

/**
 * Runs the script as a child process against a local JSON-RPC stub that answers only
 * eth_getTransactionByHash for HASH on SECRET_PATH (with `transaction`, or null for "not
 * indexed yet") and records anything else as unexpected.
 */
async function runScript(args: string[], transaction: object | null, nodeArgs: string[] = []): Promise<Run> {
  const requests: string[] = [];
  const unexpected: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      requests.push(method);
      const known = request.url === SECRET_PATH && method === "eth_getTransactionByHash" && params[0] === HASH;
      if (!known) unexpected.push(`${request.url} ${method}`);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          known
            ? { jsonrpc: "2.0", id, result: transaction }
            : { jsonrpc: "2.0", id, error: { code: -32601, message: "unexpected request" } },
        ),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<Run>((done) => {
      execFile(
        process.execPath,
        [...nodeArgs, SCRIPT, ...args],
        { cwd: PACKAGE_DIR, env: { ...process.env, CELO_RPC_URL: `http://127.0.0.1:${port}${SECRET_PATH}` }, timeout: 30_000 },
        (error, stdout, stderr) =>
          done({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout, stderr, port, requests, unexpected }),
      );
    });
  } finally {
    await new Promise((done) => server.close(done));
  }
}

/** The endpoint's URL, host and path (which stands in for an API key) never reach the output. */
function expectEndpointHidden({ stdout, stderr, port }: Run) {
  for (const output of [stdout, stderr]) {
    expect(output).not.toContain(`127.0.0.1:${port}`);
    expect(output).not.toContain(SECRET_PATH);
    expect(output).not.toContain("s3cret-key");
  }
}

describe("scripts/verify-tx.mjs", () => {
  it("exits 0 and prints ATTRIBUTED for our tagged operation in a shared bundle", async () => {
    const run = await runScript([HASH, OURS], sharedBundle());

    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(new RegExp(`^ATTRIBUTED: ${OURS} has ${ATTRIBUTION_CODE}$`, "m"));
    expect(run.stdout).toContain(RPC_LINE);
    expect(run.unexpected).toEqual([]);
    expectEndpointHidden(run);
  });

  it("exits 1 and prints NOT ATTRIBUTED for a sender whose operation carries another code", async () => {
    const run = await runScript([HASH, OTHER], sharedBundle());

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(new RegExp(`^NOT ATTRIBUTED: no operation from ${OTHER} has ${ATTRIBUTION_CODE}$`, "m"));
    expect(run.stdout).toContain(RPC_LINE);
    expect(run.unexpected).toEqual([]);
    expectEndpointHidden(run);
  });

  it("exits 2 and prints UNKNOWN when the transaction is not indexed yet", async () => {
    const run = await runScript([HASH, OURS], null);

    expect(run.code).toBe(2);
    expect(run.stdout).toMatch(/^UNKNOWN: /m);
    // The probe shows two hashes; passing the UserOperation hash must not read as "retry later".
    expect(run.stdout).toContain("not the UserOperation hash");
    expect(run.stdout).not.toContain("ATTRIBUTED");
    expect(run.stdout).toContain(RPC_LINE);
    expect(run.requests).toContain("eth_getTransactionByHash");
    expect(run.unexpected).toEqual([]);
    expectEndpointHidden(run);
  });

  it("exits 64 for an invalid transaction hash, without reaching the RPC", async () => {
    const run = await runScript(["0x1234", OURS], sharedBundle());

    expect(run.code).toBe(64);
    expect(run.stderr).toContain("Invalid or missing txHash: 0x1234");
    expect(run.requests).toEqual([]);
    expectEndpointHidden(run);
  });
});
