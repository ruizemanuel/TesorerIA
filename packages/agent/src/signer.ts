import { withAttribution } from "@celo/attribution-tags";
import { ATTRIBUTION_CODE, ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
import { type Address, type Hash, type Hex, type Transport, concat, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { USDT_FEE_ADAPTER } from "./chain";

/** A transaction from the agent: a call (`to` set) or a contract creation (`to` left out). */
export type AgentTransaction = { to?: Address; data: Hex };

export type AgentSigner = {
  address: Address;
  /**
   * Signs and sends a CIP-64 transaction that pays its gas in USDT, through the fee-currency adapter,
   * with TesorerIA's ERC-8021 attribution suffix appended to `data`. Returns the transaction hash.
   */
  send: (tx: AgentTransaction) => Promise<Hash>;
  /**
   * What `send` would use, without sending: gas, the max fee per gas and the max cost, both in the
   * adapter's units (USDT with 18 decimals).
   */
  estimate: (tx: AgentTransaction) => Promise<{ gas: bigint; maxFeePerGas: bigint; maxCost: bigint }>;
};

/**
 * The agent's own wallet on Celo. Its only way to send is `send`, so no transaction can skip the tag
 * or the fee currency.
 */
export function createAgentSigner({ privateKey, transport }: { privateKey: Hex; transport: Transport }): AgentSigner {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: celo, transport }).extend(withAttribution(ATTRIBUTION_CODE));
  return {
    address: account.address,
    send: ({ to, data }) => wallet.sendTransaction({ to, data, feeCurrency: USDT_FEE_ADAPTER }),
    estimate: async ({ to, data }) => {
      const { gas, maxFeePerGas } = await wallet.prepareTransactionRequest({
        to,
        data: concat([data, ATTRIBUTION_SUFFIX]),
        feeCurrency: USDT_FEE_ADAPTER,
      });
      return { gas, maxFeePerGas, maxCost: gas * maxFeePerGas };
    },
  };
}
