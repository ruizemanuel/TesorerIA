import { type LanguageModel, type SystemModelMessage, isStepCount } from "ai";
import type { Country } from "../countries";
import type { Locale } from "../i18n/locales";
import { chatInstructions } from "./instructions";
import { CHAT_MAX_OUTPUT_TOKENS, CHAT_MAX_STEPS } from "./limits";
import { chatTools } from "./tools";

/**
 * What every chat call sends (spec, 8.2 and 12): the fixed instructions of the page's language and the fund's country
 * first, marked for Anthropic's cache (each pair has its own), then the fund's brief; the country's one tool; and the
 * caps. Effort is "low", the chat's: set on Anthropic's own options, it leaves the thinking's display at "omitted", so
 * no reasoning text reaches the browser. The route and the check script both start from this.
 */
export function chatCall({ model, brief, locale, country }: { model: LanguageModel; brief: string; locale: Locale; country: Country }) {
  const instructions: SystemModelMessage[] = [
    { role: "system", content: chatInstructions(locale, country), providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
    { role: "system", content: brief },
  ];
  return {
    model,
    instructions,
    tools: chatTools(country),
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    stopWhen: isStepCount(CHAT_MAX_STEPS),
    providerOptions: { anthropic: { effort: "low" } },
  };
}
