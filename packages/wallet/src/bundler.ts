import { createPimlicoClient } from "permissionless/clients/pimlico";
import { type Transport, http } from "viem";
import { type BundlerClientConfig, createBundlerClient, entryPoint07Address } from "viem/account-abstraction";
import type { CeloClient } from "./account";
import { ATTRIBUTION_SUFFIX } from "./attribution";

/** A viem bundler client that appends the attribution suffix to every UserOperation's callData. */
export function createTaggedBundlerClient(parameters: Omit<BundlerClientConfig, "dataSuffix">) {
  return createBundlerClient({ ...parameters, dataSuffix: ATTRIBUTION_SUFFIX });
}

/** Pimlico's bundler + paymaster endpoint (https://docs.pimlico.io/guides/supported-chains). */
export function pimlicoTransport(apiKey: string, chainId = 42220) {
  return http(`https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(apiKey)}`);
}

/**
 * Tagged bundler client that sends through Pimlico, sponsored by `sponsorshipPolicyId`
 * (ERC-7677 paymaster context) and priced with Pimlico's "fast" gas price.
 */
export function createPimlicoBundlerClient({
  client,
  transport,
  sponsorshipPolicyId,
}: {
  client: CeloClient;
  transport: Transport;
  sponsorshipPolicyId: string;
}) {
  const pimlicoClient = createPimlicoClient({
    transport,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });
  return createTaggedBundlerClient({
    client,
    transport,
    paymaster: pimlicoClient,
    paymasterContext: { sponsorshipPolicyId },
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });
}
