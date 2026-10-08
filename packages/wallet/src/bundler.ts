import { createPimlicoClient } from "permissionless/clients/pimlico";
import { type HttpTransport, type Transport, http } from "viem";
import { type BundlerClientConfig, createBundlerClient, entryPoint07Address } from "viem/account-abstraction";
import type { CeloClient } from "./account";
import { ATTRIBUTION_SUFFIX } from "./attribution";

/** A viem bundler client that appends the attribution suffix to every UserOperation's callData. */
export function createTaggedBundlerClient(parameters: Omit<BundlerClientConfig, "dataSuffix">) {
  return createBundlerClient({ ...parameters, dataSuffix: ATTRIBUTION_SUFFIX });
}

/**
 * Pimlico's bundler + paymaster endpoint (https://docs.pimlico.io/guides/supported-chains).
 * The API key travels in the URL, and viem puts that URL into the errors it throws,
 * so every error is scrubbed of the key before it leaves the transport.
 */
export function pimlicoTransport(apiKey: string, chainId = 42220): HttpTransport {
  const transport = http(`https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(apiKey)}`);
  return (parameters) => {
    const { request, ...rest } = transport(parameters);
    return {
      ...rest,
      request: (async (args, options) => {
        try {
          return await request(args, options);
        } catch (error) {
          redactApiKey(error, apiKey);
          throw error;
        }
      }) as typeof request,
    };
  };
}

/** Replaces the key (raw and URL-encoded) with `***` in place, along the error's `cause` chain. */
function redactApiKey(error: unknown, apiKey: string) {
  if (!apiKey) return;
  const scrub = (text: string) => text.replaceAll(encodeURIComponent(apiKey), "***").replaceAll(apiKey, "***");
  const seen = new Set<unknown>();
  for (let current = error; typeof current === "object" && current !== null && !seen.has(current); ) {
    seen.add(current);
    const fields = current as Record<string, unknown>;
    for (const name of ["message", "shortMessage", "details", "stack", "url"]) {
      const value = fields[name];
      if (typeof value !== "string" || scrub(value) === value) continue;
      try {
        fields[name] = scrub(value);
      } catch {} // a read-only field is left as is
    }
    if (Array.isArray(fields.metaMessages)) {
      fields.metaMessages.forEach((line, index, lines) => {
        if (typeof line === "string") lines[index] = scrub(line);
      });
    }
    current = fields.cause;
  }
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
