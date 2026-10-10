import { ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
import { type Address, type Hex, concat, encodeFunctionData, encodePacked, getAddress, parseAbi, size } from "viem";

// What a member's Safe signs, built here the way permissionless builds it (test/bundler-flow.test.ts checks the gate
// against the real thing).
const safe4337Abi = parseAbi([
  "function executeUserOp(address to, uint256 value, bytes data, uint8 operation)",
  "function executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)",
]);
export const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);
export const MULTI_SEND_CALL_ONLY = getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2");
/** Safe's other MultiSend, which can also delegatecall. */
export const MULTI_SEND = getAddress("0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526");

export type Inner = { to: Address; value?: bigint; data?: Hex; operation?: number };

/** MultiSend's packed list of calls. */
export function packed(calls: Inner[]): Hex {
  if (calls.length === 0) return "0x";
  return concat(
    calls.map(({ to, value = 0n, data = "0x", operation = 0 }) =>
      encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [operation, to, value, BigInt(size(data)), data]),
    ),
  );
}

export const multiSend = (calls: Inner[]) => encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packed(calls)] });

/** Safe4337Module's call, by hand: `to`, `value`, `data` and `operation` exactly as given. */
export function execute(
  to: Address,
  value: bigint,
  data: Hex,
  operation: number,
  functionName: "executeUserOp" | "executeUserOpWithErrorString" = "executeUserOpWithErrorString",
): Hex {
  return encodeFunctionData({ abi: safe4337Abi, functionName, args: [to, value, data, operation] });
}

/** The callData for `calls`: one call as it is, several through MultiSendCallOnly; tagged as the web tags it. */
export function safeCallData(calls: Inner[], tagged = true): Hex {
  const [only] = calls;
  const data = calls.length === 1 && only ? execute(only.to, only.value ?? 0n, only.data ?? "0x", 0) : execute(MULTI_SEND_CALL_ONLY, 0n, multiSend(calls), 1);
  return tagged ? concat([data, ATTRIBUTION_SUFFIX]) : data;
}
