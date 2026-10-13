import { MAX_NOTE_LENGTH } from "@tesoreria/agent";
import { type InferUITools, type UIMessage, tool } from "ai";
import { z } from "zod";
import { MAX_PESOS, parsePesos } from "../format";

/** Pesos as the member said them, read the app's way (parsePesos): "45.000" or "45.000,50", above zero, up to MAX_PESOS. */
const pesos = z
  .string()
  .max(40)
  .refine((text) => {
    const units = parsePesos(text);
    return units !== null && units <= MAX_PESOS;
  }, "Write the amount in pesos, like 45.000 or 45.000,50");

export const proposeExpenseInput = z.object({
  kind: z.enum(["agreed", "other"]).describe('"agreed" only for the fund\'s agreed expense, named in the brief; "other" for anything else.'),
  amount: pesos.describe('The amount in pesos, as the member said it, like "45.000" or "45.000,50". Never guessed.'),
  note: z.string().max(MAX_NOTE_LENGTH).describe("A few words on what it was for."),
});
export type ProposedExpense = z.infer<typeof proposeExpenseInput>;

/** The card's answer: the expense's status from the expenses route, or "dismissed". */
const proposeExpenseOutput = z.object({ status: z.string().max(20) });

/**
 * The chat's one tool (spec, 8.2). It has no `execute`: the browser shows the member a card, they confirm it, and the
 * card loads the expense through the same route as the Cargar gasto panel. The one who gets paid is always the member
 * of the session, and the card carries no address.
 */
export const chatTools = {
  proposeExpense: tool({
    description:
      "Shows the member a card to load an expense they paid for the group. They confirm it themselves; you load nothing. Use it only once you know the amount and what it was for.",
    inputSchema: proposeExpenseInput,
    outputSchema: proposeExpenseOutput,
  }),
};

/** What the route sends with each answer: the member's messages left today, and how it ended. */
export type ChatMetadata = { remaining?: number; finish?: string };
export type ChatUIMessage = UIMessage<ChatMetadata, never, InferUITools<typeof chatTools>>;
