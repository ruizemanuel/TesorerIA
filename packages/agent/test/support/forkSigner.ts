import { withAttribution } from "@celo/attribution-tags";
import { ATTRIBUTION_CODE, ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
import { type Hex, type Transport, concat, createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import type { AgentSigner } from "../../src/signer";

/**
 * The agent's signer for an anvil fork. Anvil can't decode CIP-64 transactions (checked with anvil 1.8.5,
 * `--celo` included), so this one pays gas in CELO; the data and the attribution suffix are the same.
 * createAgentSigner's own tests cover the CIP-64 side.
 */
export function forkSigner(privateKey: Hex, transport: Transport): AgentSigner {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: celo, transport }).extend(withAttribution(ATTRIBUTION_CODE));
  const client = createPublicClient({ chain: celo, transport });
  return {
    address: account.address,
    send: ({ to, data }) => wallet.sendTransaction({ to, data }),
    estimate: async ({ to, data }) => {
      const gas = await client.estimateGas({ account, to, data: concat([data, ATTRIBUTION_SUFFIX]) });
      const { maxFeePerGas } = await client.estimateFeesPerGas();
      return { gas, maxFeePerGas, maxCost: gas * maxFeePerGas };
    },
  };
}
