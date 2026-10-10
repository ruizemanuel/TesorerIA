import { type Address, type Hash, createPublicClient, createWalletClient, http, numberToHex, parseEventLogs } from "viem";
import {
  type RpcUserOperation,
  type UserOperation,
  entryPoint07Abi,
  entryPoint07Address,
  formatUserOperation,
  getUserOperationHash,
  toPackedUserOperation,
} from "viem/account-abstraction";
import { celo } from "viem/chains";

/**
 * Fixed gas limits. The call limit has room for `FundFactory.createFund`: the Fund's ~14.7 KB of runtime
 * costs ~2.95M gas in code deposit alone. The verification limit is generous for a Safe's first operation
 * (deploy + batch used ~543k on mainnet). The prefund is these limits times the fee, a few CELO at most.
 */
const GAS_LIMITS = { callGasLimit: 8_000_000n, verificationGasLimit: 2_000_000n, preVerificationGas: 100_000n };

/**
 * A stand-in for Pimlico on an anvil fork of Celo, for the web's end-to-end tests and local runs: it answers
 * the JSON-RPC methods viem and Pimlico's client use, and runs each UserOperation with `handleOps` from one
 * of anvil's unlocked accounts. There is no paymaster: an account pays its gas with its own CELO, which
 * the tests give it with `anvil_setBalance`. Never point it at a real network.
 */
export function createForkBundler({ rpcUrl }: { rpcUrl: string }) {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: celo, transport });
  const walletClient = createWalletClient({ chain: celo, transport });
  const sent = new Map<Hash, Hash>(); // userOpHash → transaction hash

  async function request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
    switch (method) {
      case "eth_chainId":
        return numberToHex(celo.id);
      case "eth_supportedEntryPoints":
        return [entryPoint07Address];
      case "pm_getPaymasterStubData":
      case "pm_getPaymasterData":
        return {}; // no paymaster: the account pays with its own CELO
      case "pimlico_getUserOperationGasPrice": {
        const { baseFeePerGas } = await publicClient.getBlock();
        const fee = {
          maxFeePerGas: numberToHex((baseFeePerGas ?? 0n) * 2n),
          maxPriorityFeePerGas: numberToHex(1_000_000_000n),
        };
        return { slow: fee, standard: fee, fast: fee };
      }
      case "eth_estimateUserOperationGas":
        return {
          callGasLimit: numberToHex(GAS_LIMITS.callGasLimit),
          verificationGasLimit: numberToHex(GAS_LIMITS.verificationGasLimit),
          preVerificationGas: numberToHex(GAS_LIMITS.preVerificationGas),
        };
      case "eth_sendUserOperation": {
        const userOperation = formatUserOperation(params[0] as RpcUserOperation) as UserOperation<"0.7">;
        const [executor] = (await walletClient.getAddresses()) as [Address];
        const tx = await walletClient.writeContract({
          account: executor,
          address: entryPoint07Address,
          abi: entryPoint07Abi,
          functionName: "handleOps",
          args: [[toPackedUserOperation(userOperation)], executor],
        });
        const userOpHash = getUserOperationHash({
          chainId: celo.id,
          entryPointAddress: entryPoint07Address,
          entryPointVersion: "0.7",
          userOperation,
        });
        sent.set(userOpHash, tx);
        return userOpHash;
      }
      case "eth_getUserOperationReceipt": {
        const userOpHash = params[0] as Hash;
        const tx = sent.get(userOpHash);
        if (tx === undefined) return null;
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
        const event = parseEventLogs({ abi: entryPoint07Abi, eventName: "UserOperationEvent", logs: receipt.logs }).find(
          (log) => log.args.userOpHash === userOpHash,
        );
        if (event === undefined) throw new Error(`fork bundler: no UserOperationEvent for ${userOpHash}`);
        const rpcReceipt = await publicClient.request({ method: "eth_getTransactionReceipt", params: [tx] });
        return {
          userOpHash,
          entryPoint: entryPoint07Address,
          sender: event.args.sender,
          nonce: numberToHex(event.args.nonce),
          paymaster: event.args.paymaster,
          actualGasCost: numberToHex(event.args.actualGasCost),
          actualGasUsed: numberToHex(event.args.actualGasUsed),
          success: event.args.success,
          logs: rpcReceipt?.logs ?? [],
          receipt: rpcReceipt,
        };
      }
      default:
        throw new Error(`fork bundler: ${method} is not supported`);
    }
  }

  return { request };
}
