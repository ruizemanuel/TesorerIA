import type { LanguageModel } from "ai";
import { env } from "../env";

/** Whether the chat is on (spec, 8.2): CHAT_MODEL is its switch, like AGENT_SEND is the agent's. */
export function chatEnabled(): boolean {
  return env().CHAT_MODEL !== undefined;
}

/**
 * The chat's model. A plain model id like "anthropic/claude-sonnet-5.5" goes through the AI Gateway, which
 * authenticates with the deployment's VERCEL_OIDC_TOKEN (or AI_GATEWAY_API_KEY, when set). "mock" is the end-to-end
 * test's scripted model, loaded only then, and only on the fork (env.ts).
 */
export async function chatModel(): Promise<LanguageModel> {
  const { CHAT_MODEL } = env();
  if (CHAT_MODEL === undefined) throw new Error("CHAT_MODEL is not set: the chat is off");
  if (CHAT_MODEL === "mock") return (await import("./scripted-model")).scriptedModel();
  return CHAT_MODEL;
}
