import { BaseError } from "viem";

/** An error's short message: viem's long messages and causes can carry the RPC URL, and with it an API key. */
export function shortMessage(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}
