import { type Address, type Hash, type Hex, concat, encodeAbiParameters, keccak256, pad, parseAbiParameters } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";

/** A UserOperation for EntryPoint v0.7 as JSON-RPC carries it: quantities in hex. */
export type RpcOperation = {
  sender: Address;
  nonce: Hex;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymaster?: Address;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;
  paymasterData?: Hex;
  signature?: Hex;
};

const u128 = (quantity: Hex | undefined) => pad(quantity ?? "0x0", { size: 16 });

/**
 * EntryPoint v0.7's `getUserOpHash` on Celo, written out from the contract rather than taken from viem: the
 * operation packed as `UserOperationLib.encode` packs it (initCode = factory ‖ factoryData; accountGasLimits =
 * verificationGasLimit ‖ callGasLimit; gasFees = maxPriorityFeePerGas ‖ maxFeePerGas; paymasterAndData = paymaster ‖
 * its two gas limits ‖ paymasterData), hashed, and hashed again with the EntryPoint and the chain id. The signature
 * isn't part of it. It is the hash a bundler answers eth_sendUserOperation with.
 */
export function entryPointHash(op: RpcOperation): Hash {
  const initCode = op.factory === undefined ? "0x" : concat([op.factory, op.factoryData ?? "0x"]);
  const paymasterAndData =
    op.paymaster === undefined
      ? "0x"
      : concat([op.paymaster, u128(op.paymasterVerificationGasLimit), u128(op.paymasterPostOpGasLimit), op.paymasterData ?? "0x"]);
  const encoded = encodeAbiParameters(parseAbiParameters("address, uint256, bytes32, bytes32, bytes32, uint256, bytes32, bytes32"), [
    op.sender,
    BigInt(op.nonce),
    keccak256(initCode),
    keccak256(op.callData),
    concat([u128(op.verificationGasLimit), u128(op.callGasLimit)]),
    BigInt(op.preVerificationGas),
    concat([u128(op.maxPriorityFeePerGas), u128(op.maxFeePerGas)]),
    keccak256(paymasterAndData),
  ]);
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32, address, uint256"), [keccak256(encoded), entryPoint07Address, 42220n]));
}
