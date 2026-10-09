import { type Hex, isHex } from "viem";

/** AGENT_PRIVATE_KEY from packages/agent/.env.local, or undefined if it's missing or malformed. Never printed. */
export function agentKey(): Hex | undefined {
  const key = process.env.AGENT_PRIVATE_KEY;
  return key !== undefined && isHex(key) && key.length === 66 ? key : undefined;
}

/**
 * An RPC URL from `variable`, or the public `fallback`. A custom endpoint usually carries an API key in its
 * path or query, so `label` is what to print instead of the URL.
 */
export function rpcUrl(variable: string, fallback: string): { url: string; label: string } {
  const url = process.env[variable];
  return url === undefined ? { url: fallback, label: fallback } : { url, label: `custom endpoint from ${variable}` };
}
