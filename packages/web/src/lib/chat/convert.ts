// The two conversions between the browser's messages and the model's (spec, 8.2). The chat route uses them, and so
// does the check script (scripts/chat-check.ts), so the real model's answers take the same path as the browser's.
import { MAX_NOTE_LENGTH } from "@tesoreria/agent";
import { InvalidToolInputError, type ModelMessage, NoSuchToolError, type TextStreamPart, convertToModelMessages, toUIMessageStream } from "ai";
import { CHAT_UNAVAILABLE } from "./texts";
import { type ChatMetadata, type ChatUIMessage, chatTools } from "./tools";

/**
 * The history as the model reads it, from the conversation readChatRequest checked. A card the member never
 * answered is left out (the panel answers it first): an open tool call would fail the call.
 */
export function toModelMessages(messages: ChatUIMessage[]): Promise<ModelMessage[]> {
  return convertToModelMessages(messages, { tools: chatTools, ignoreIncompleteToolCalls: true });
}

/** What the model reads when its card was wrong. Fixed text: the card's own input is never echoed back to it or to a log. */
export const BAD_CARD_HINT = `Invalid input: write the amount in pesos, like 45.000 or 45.000,50, above zero, and a note of up to ${MAX_NOTE_LENGTH} characters.`;

/**
 * The answer as the browser reads it, with the member's messages left today (`remaining`) and how it ended. Errors
 * are only mapped: a failure was logged by whoever called the model. A card the model got wrong, or a tool it doesn't
 * have, goes back to the model as a hint (the card itself says CHAT_BAD_CARD); a tool's own error reaches here as a
 * string. Anything else is the member's CHAT_UNAVAILABLE.
 */
export function toAnswerStream(stream: ReadableStream<TextStreamPart<typeof chatTools>>, remaining: number) {
  return toUIMessageStream<typeof chatTools, ChatUIMessage>({
    stream,
    tools: chatTools,
    messageMetadata: ({ part }): ChatMetadata | undefined => {
      if (part.type === "start") return { remaining };
      if (part.type === "finish") return { remaining, finish: part.rawFinishReason === "refusal" ? "refusal" : part.finishReason };
      return undefined;
    },
    onError: (error) =>
      InvalidToolInputError.isInstance(error) || NoSuchToolError.isInstance(error) || typeof error === "string" ? BAD_CARD_HINT : CHAT_UNAVAILABLE,
  });
}
