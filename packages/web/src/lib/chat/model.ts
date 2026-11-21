import type { LanguageModel } from "ai";
import type { Country } from "../countries";
import { env } from "../env";

/** Whether the chat is on (spec, 8.2): CHAT_MODEL is its switch, like AGENT_SEND is the agent's. */
export function chatEnabled(): boolean {
  return env().CHAT_MODEL !== undefined;
}

/**
 * The chat's model for a fund in `country`. A plain model id like "anthropic/claude-sonnet-5.5" goes through the AI
 * Gateway, which authenticates with the deployment's VERCEL_OIDC_TOKEN (or AI_GATEWAY_API_KEY, when set): the country
 * reaches that model through its instructions and its tool (chatCall). "mock" is the end-to-end test's scripted model,
 * which writes its card's amount the country's way; it's loaded only then, and only on the fork (env.ts).
 */
export async function chatModel(country: Country): Promise<LanguageModel> {
  const { CHAT_MODEL } = env();
  if (CHAT_MODEL === undefined) throw new Error("CHAT_MODEL is not set: the chat is off");
  if (CHAT_MODEL === "mock") return (await import("./scripted-model")).scriptedModel(country);
  return CHAT_MODEL;
}
