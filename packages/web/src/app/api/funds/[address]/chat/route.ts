import { shortMessage } from "@tesoreria/agent";
import { APICallError, type LanguageModel, type ModelMessage, createUIMessageStreamResponse, streamText } from "ai";
import { isAddress } from "viem";
import { z } from "zod";
import { fundBrief } from "../../../../../lib/chat/brief";
import { chatCall } from "../../../../../lib/chat/call";
import { toAnswerStream, toModelMessages } from "../../../../../lib/chat/convert";
import { MAX_CHAT_BODY_BYTES } from "../../../../../lib/chat/limits";
import { chatEnabled, chatModel } from "../../../../../lib/chat/model";
import { recordChatUsage, reserveChatMessage } from "../../../../../lib/chat/quota";
import { readChatRequest } from "../../../../../lib/chat/request";
import { CHAT_MEMBER_LIMIT, CHAT_NOT_FOUND, CHAT_UNAVAILABLE } from "../../../../../lib/chat/texts";
import { currentUser } from "../../../../../lib/current-user";
import { getDb } from "../../../../../lib/db/client";
import { env } from "../../../../../lib/env";
import { jsonError, readJson } from "../../../../../lib/http";
import { type FundScreen, loadFundScreen } from "../../../../../lib/read-fund";

// One answer: a model call or two, well within a minute.
export const maxDuration = 60;

// What DefaultChatTransport sends; its other fields (id, trigger, messageId) are dropped.
const ChatBody = z.object({ messages: z.array(z.unknown()).min(1).max(50) });

/** What an error is, never what it says: a validation error's message carries the model's text (spec, 8.2). */
function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : "unknown error";
  return APICallError.isInstance(error) && error.statusCode !== undefined ? `${name} ${error.statusCode}` : name;
}

/** A step's tokens added up over the steps, or undefined when none of them reports any. */
function sumTokens(counts: Array<number | undefined>): number | undefined {
  const known = counts.filter((count): count is number => count !== undefined);
  return known.length === 0 ? undefined : known.reduce((total, count) => total + count, 0);
}

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

  // Everything that can fail before the model comes before the cap, so a failure costs the member nothing: the
  // brief, the history as the model reads it, and the model itself.
  let screen: FundScreen | null;
  try {
    screen = await loadFundScreen(address, user);
  } catch (error) {
    console.error(`The chat could not read fund ${address}: ${shortMessage(error)}`);
    return jsonError(503, CHAT_UNAVAILABLE);
  }
  if (screen === null) return jsonError(404, CHAT_NOT_FOUND);
  let messages: ModelMessage[];
  let model: LanguageModel;
  try {
    messages = await toModelMessages(conversation.messages);
    model = await chatModel();
  } catch (error) {
    console.error(`The chat could not start for fund ${address}: ${describeError(error)}`);
    return jsonError(503, CHAT_UNAVAILABLE);
  }

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
    ...chatCall({ model, brief: fundBrief(screen, user.name, new Date()) }),
    messages,
    abortSignal: request.signal,
    onEnd: async ({ usage, finishReason, rawFinishReason }) => {
      await recordChatUsage(db, reservation.id, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        finish: rawFinishReason === "refusal" ? "refusal" : finishReason,
      });
    },
    // The member left before the end: onEnd doesn't run, so the steps done so far are what the message cost.
    onAbort: async ({ steps }) => {
      await recordChatUsage(db, reservation.id, {
        inputTokens: sumTokens(steps.map((step) => step.usage.inputTokens)),
        outputTokens: sumTokens(steps.map((step) => step.usage.outputTokens)),
        finish: "abort",
      });
    },
    // The model or the gateway failed (a card the model got wrong is no failure: it never gets here). One line, with
    // only what failed; the SDK would log the whole error. It's awaited, so onEnd's write, if any, comes after.
    onError: async ({ error }) => {
      console.error(`The chat failed for fund ${address}: ${describeError(error)}`);
      await recordChatUsage(db, reservation.id, { finish: "error" }).catch(() => {});
    },
  });

  return createUIMessageStreamResponse({ stream: toAnswerStream(result.stream, reservation.remaining) });
}
