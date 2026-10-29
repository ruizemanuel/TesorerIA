import { getAddress } from "viem";
import { env } from "../../lib/env";
import { llmsTxt } from "../../lib/llms-txt";

/** The site for an agent that reads it (llmstxt.org), in plain text. */
export function GET(): Response {
  const { ORIGIN, PUBLIC_FUND } = env();
  return new Response(llmsTxt(ORIGIN, PUBLIC_FUND === undefined ? null : getAddress(PUBLIC_FUND)), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
