import { shortMessage } from "@tesoreria/agent";
import { InvalidToolInputError, convertToModelMessages, createUIMessageStreamResponse, streamText, toUIMessageStream } from "ai";
import { isAddress } from "viem";
import { z } from "zod";
import { fundBrief } from "../../../../../lib/chat/brief";
import { chatCall } from "../../../../../lib/chat/call";
import { MAX_CHAT_BODY_BYTES } from "../../../../../lib/chat/limits";
import { chatEnabled, chatModel } from "../../../../../lib/chat/model";
import { recordChatUsage, reserveChatMessage } from "../../../../../lib/chat/quota";
import { readChatRequest } from "../../../../../lib/chat/request";
import { CHAT_MEMBER_LIMIT, CHAT_NOT_FOUND, CHAT_UNAVAILABLE } from "../../../../../lib/chat/texts";
import { type ChatMetadata, type ChatUIMessage, chatTools } from "../../../../../lib/chat/tools";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { env } from "../../../../../lib/env";
import { jsonError, readJson } from "../../../../../lib/http";
import { type FundScreen, loadFundScreen } from "../../../../../lib/read-fund";

// One answer: a model call or two, well within a minute.
export const maxDuration = 60;

// What DefaultChatTransport sends; its other fields (id, trigger, messageId) are dropped.
const ChatBody = z.object({ messages: z.array(z.unknown()).min(1).max(50) });

/** The chat with the agent (spec, 8.2): one message of a member of a live fund, answered as a stream. */
export async function POST(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const user = await currentUser();
  if (user === null) return jsonError(401, "Entrá con tu passkey.");
  const { address } = await params;
  if (!chatEnabled() || !isAddress(address, { strict: false })) return jsonError(404, CHAT_NOT_FOUND);
  // The cap holds for the bytes actually read, not only for the length the request declares (a chunked body has none).
  const body = await readJson(request, ChatBody, { maxBytes: MAX_CHAT_BODY_BYTES });
  if (!body.ok) return body.response;
  const conversation = await readChatRequest(body.value.messages);
  if (!conversation.ok) return jsonError(400, conversation.error);

  // The brief comes before the cap: a read that fails costs the member nothing.
  let screen: FundScreen | null;
  try {
    screen = await loadFundScreen(address, user);
  } catch (error) {
    console.error(`The chat could not read fund ${address}: ${shortMessage(error)}`);
    return jsonError(503, CHAT_UNAVAILABLE);
  }
  if (screen === null) return jsonError(404, CHAT_NOT_FOUND);

  const db = await getDb();
  const { CHAT_MEMBER_DAILY_LIMIT, CHAT_DAILY_LIMIT } = env();
  const reservation = await reserveChatMessage(db, {
    userId: user.id,
    fundId: screen.fundId,
    memberLimit: CHAT_MEMBER_DAILY_LIMIT,
    globalLimit: CHAT_DAILY_LIMIT,
  });
  if (!reservation.ok) return jsonError(429, reservation.limit === "member" ? CHAT_MEMBER_LIMIT : CHAT_UNAVAILABLE);

  const result = streamText({
    ...chatCall({ model: await chatModel(), brief: fundBrief(screen, user.name, new Date()) }),
    // A card the member never answered is left out (the panel answers it first): an open tool call would fail the call.
    messages: await convertToModelMessages(conversation.messages, { tools: chatTools, ignoreIncompleteToolCalls: true }),
    abortSignal: request.signal,
    onEnd: async ({ usage, finishReason, rawFinishReason }) => {
      await recordChatUsage(db, reservation.id, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        finish: rawFinishReason === "refusal" ? "refusal" : finishReason,
      });
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof chatTools, ChatUIMessage>({
      stream: result.stream,
      tools: chatTools,
      messageMetadata: ({ part }): ChatMetadata | undefined => {
        if (part.type === "start") return { remaining: reservation.remaining };
        if (part.type === "finish") {
          return { remaining: reservation.remaining, finish: part.rawFinishReason === "refusal" ? "refusal" : part.finishReason };
        }
        return undefined;
      },
      onError: (error) => {
        // A card the model got wrong goes back to it, which may fix it; the card itself says CHAT_BAD_CARD.
        if (InvalidToolInputError.isInstance(error)) return `Invalid input: ${shortMessage(error)}`;
        console.error(`The chat failed for fund ${address}: ${shortMessage(error)}`);
        void recordChatUsage(db, reservation.id, { finish: "error" }).catch(() => {});
        return CHAT_UNAVAILABLE;
      },
    }),
  });
}
