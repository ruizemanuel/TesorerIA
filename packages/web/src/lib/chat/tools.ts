import { MAX_NOTE_LENGTH } from "@tesoreria/agent";
import { type InferUITools, type UIMessage, tool } from "ai";
import { z } from "zod";
import { COUNTRIES, COUNTRY_CODES, type Country, type CountryCode } from "../countries";
import { MAX_PESOS, WARS_UNIT, amountExamples, parseMoneyInChat } from "../format";
import { LOCALES, type Locale } from "../i18n/locales";

/** Each language's name in English: the model reads its tool, and the hint for a card it got wrong, in English. */
const LANGUAGE_NAMES: Record<Locale, string> = { es: "Spanish", en: "English" };

/**
 * How an amount may be written in `country`, said to the model: each language's way, without cents and with them
 * ("45.000 or 45.000,50 in Spanish, 45,000 or 45,000.50 in English" in Argentina), or the one way when both languages
 * write it alike ("45,000 or 45,000.50" in Mexico). `quote` wraps each example, as the tool's description does.
 */
export function amountFormats(country: Country, quote: (amount: string) => string = (amount) => amount): string {
  const ways = LOCALES.map((locale) => {
    const [whole, cents] = amountExamples(45_000n * WARS_UNIT, { locale, country });
    return { locale, said: `${quote(whole)} or ${quote(cents)}` };
  });
  if (ways.every((way) => way.said === ways[0]!.said)) return ways[0]!.said;
  return ways.map((way) => `${way.said} in ${LANGUAGE_NAMES[way.locale]}`).join(", ");
}

/**
 * What the model may put on a card of a fund in `country`. The amount is pesos as the member said them, read in either
 * of the country's languages' way (parseMoneyInChat): the model writes as the page does, and one tool serves both
 * languages. Above zero, up to MAX_PESOS.
 */
function inputOf(country: Country) {
  const pesos = z
    .string()
    .max(40)
    .refine((text) => {
      const units = parseMoneyInChat(text, country);
      return units !== null && units <= MAX_PESOS;
    }, `Write the amount in pesos, like ${amountFormats(country)}`);
  return z.object({
    kind: z.enum(["agreed", "other"]).describe('"agreed" only for the fund\'s agreed expense, named in the brief; "other" for anything else.'),
    amount: pesos.describe(`The amount in pesos, as the member said it: ${amountFormats(country, (amount) => `"${amount}"`)}. Never guessed.`),
    note: z.string().max(MAX_NOTE_LENGTH).describe("A few words on what it was for."),
  });
}
export type ProposedExpense = z.infer<ReturnType<typeof inputOf>>;

/** The card's answer: the expense's status from the expenses route, or "dismissed". */
const proposeExpenseOutput = z.object({ status: z.string().max(20) });

/**
 * The chat's one tool (spec, 8.2). It has no `execute`: the browser shows the member a card, they confirm it, and the
 * card loads the expense through the same route as the Cargar gasto panel. The one who gets paid is always the member
 * of the session, and the card carries no address.
 */
function toolsOf(input: ReturnType<typeof inputOf>) {
  return {
    proposeExpense: tool({
      description:
        "Shows the member a card to load an expense they paid for the group. They confirm it themselves; you load nothing. Use it only once you know the amount and what it was for.",
      inputSchema: input,
      outputSchema: proposeExpenseOutput,
    }),
  };
}
export type ChatTools = ReturnType<typeof toolsOf>;

/**
 * Each country's card input and tool, built once when the module loads (spec, 12): what the model reads of the tool
 * comes before the instructions in the prompt's cached prefix, so a country's never changes.
 */
const INPUTS = Object.fromEntries(COUNTRY_CODES.map((code) => [code, inputOf(COUNTRIES[code])])) as Record<CountryCode, ReturnType<typeof inputOf>>;
const TOOLS = Object.fromEntries(COUNTRY_CODES.map((code) => [code, toolsOf(INPUTS[code])])) as Record<CountryCode, ChatTools>;

/** What the model may put on a card of a fund in `country`. */
export function proposeExpenseInput(country: Country): ReturnType<typeof inputOf> {
  return INPUTS[country.code];
}

/** The chat's tools for a fund in `country`: the same object every time, so what the model reads of them holds. */
export function chatTools(country: Country): ChatTools {
  return TOOLS[country.code];
}

/** What the route sends with each answer: the member's messages left today, and how it ended. */
export type ChatMetadata = { remaining?: number; finish?: string };
export type ChatUIMessage = UIMessage<ChatMetadata, never, InferUITools<ChatTools>>;
