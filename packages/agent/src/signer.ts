import { fromDataSuffix, withAttribution } from "@celo/attribution-tags";
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
 * `withAttribution` merges its code into a suffix that is already there, or leaves the data alone if that
 * suffix uses another schema, so the agent's tag could go missing without a word. The agent never builds
 * such data: refuse it.
 */
function assertUntagged(data: Hex): void {
  if (fromDataSuffix(data) !== null) {
    throw new Error("The transaction data already ends in an ERC-8021 suffix; the agent adds its own");
  }
}

/**
 * The agent's own wallet on Celo. Its only way to send is `send`, so no transaction can skip the tag
 * or the fee currency.
 */
export function createAgentSigner({ privateKey, transport }: { privateKey: Hex; transport: Transport }): AgentSigner {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: celo, transport }).extend(withAttribution(ATTRIBUTION_CODE));
  return {
    address: account.address,
    send: async ({ to, data }) => {
      assertUntagged(data);
      return wallet.sendTransaction({ to, data, feeCurrency: USDT_FEE_ADAPTER });
    },
    estimate: async ({ to, data }) => {
      assertUntagged(data);
      const { gas, maxFeePerGas } = await wallet.prepareTransactionRequest({
        to,
        data: concat([data, ATTRIBUTION_SUFFIX]),
        feeCurrency: USDT_FEE_ADAPTER,
      });
      return { gas, maxFeePerGas, maxCost: gas * maxFeePerGas };
    },
  };
}
