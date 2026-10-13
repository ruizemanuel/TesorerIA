"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } from "../lib/chat/limits";
import { CHAT_REFUSED } from "../lib/chat/texts";
import type { ChatUIMessage } from "../lib/chat/tools";
import {
  type ProposalRules,
  canRetry,
  chatErrorText,
  isRefusal,
  lastRemaining,
  pendingCards,
  remainingText,
  waitingForText,
} from "../lib/chat/view";
import { Avatar } from "./avatar";
import { useConfirmingCards, useFundConversation } from "./chat-provider";
import { ExpenseProposalCard } from "./expense-proposal-card";
import { Button, FIELD } from "./ui";

const SUGGESTIONS = ["¿Quién debe esta semana?", "¿Cuánto queda del tope de la semana?", "Quiero cargar un gasto"];

/**
 * The fund's Chat, made the first time its panel opens and kept by ChatProvider from then on (FundConversation).
 * useChat given this instance never stops it on unmount. Only the last messages are sent: the route keeps no more
 * (spec, 8.2).
 */
function useFundChat(): Chat<ChatUIMessage> {
  const conversation = useFundConversation();
  // Made on its first read, like a ref's first value: every later render, and every later panel, gets the same one.
  conversation.chat ??= new Chat<ChatUIMessage>({
    id: conversation.fund,
    transport: new DefaultChatTransport({
      api: `/api/funds/${conversation.fund}/chat`,
      prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: messages.slice(-MAX_HISTORY_MESSAGES) } }),
    }),
  });
  return conversation.chat;
}

/** The chat with the agent (spec, 9.2): plain text both ways, a card to load an expense, and the day's cap. */
export function ChatPanel({ fund, userName, rules }: { fund: string; userName: string; rules: ProposalRules }) {
  const chat = useFundChat();
  const confirming = useConfirmingCards();
  const { messages, sendMessage, status, error, regenerate, addToolOutput, clearError } = useChat({ chat });
  const [text, setText] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const errorText = error === undefined ? null : chatErrorText(error);
  const remaining = lastRemaining(messages);
  const done = remaining === 0 || (errorText !== null && !canRetry(errorText));
  const firstName = userName.split(" ")[0] ?? userName;

  // addToolOutput answers `void | PromiseLike<void>`; the card and the loop below await a promise.
  const answerCard = async (toolCallId: string, status: string) => {
    await addToolOutput({ tool: "proposeExpense", toolCallId, output: { status } });
  };

  async function send(question: string) {
    const trimmed = question.trim();
    if (trimmed === "" || busy || done) return;
    // A card left unanswered would break the next call (spec, 8.2): it's answered as dismissed first. One being
    // confirmed is left alone: its expense is on its way, and the card answers for itself when the route does.
    for (const toolCallId of pendingCards(messages, confirming)) await answerCard(toolCallId, "dismissed");
    setText("");
    clearError();
    await sendMessage({ text: trimmed });
  }

  return (
    <div className="flex min-h-full flex-col gap-3">
      <ol className="grid flex-1 content-start gap-3" aria-live="polite">
        {messages.length === 0 && (
          <li className="grid gap-3">
            <div className="flex gap-2">
              <Avatar kind="agent" />
              <p className="rounded-[14px] bg-surface p-3">Hola, {firstName}. Preguntame lo que quieras del fondo.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button key={suggestion} variant="secondary" disabled={busy || done} onClick={() => send(suggestion)}>
                  {suggestion}
                </Button>
              ))}
            </div>
          </li>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <li key={message.id} className="ml-10 justify-self-end whitespace-pre-wrap rounded-[14px] bg-primary p-3 text-white">
              {message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}
            </li>
          ) : (
            <li key={message.id} className="mr-6 flex gap-2">
              <Avatar kind="agent" />
              <div className="grid min-w-0 flex-1 gap-2">
                {message.parts.map((part, i) => {
                  if (part.type === "text" && part.text !== "") {
                    return (
                      <p key={i} className="whitespace-pre-wrap rounded-[14px] bg-surface p-3">
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type === "tool-proposeExpense") {
                    return (
                      <ExpenseProposalCard
                        key={part.toolCallId}
                        part={part}
                        fund={fund}
                        rules={rules}
                        onAnswer={(status) => answerCard(part.toolCallId, status)}
                      />
                    );
                  }
                  return null;
                })}
                {isRefusal(message) && <p className="rounded-[14px] bg-surface p-3">{CHAT_REFUSED}</p>}
              </div>
            </li>
          ),
        )}
        {waitingForText(messages, status) && (
          <li className="flex items-center gap-2 text-sm text-muted">
            <Avatar kind="agent" />
            <span>El agente está escribiendo</span>
            <span className="typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </li>
        )}
      </ol>
      {errorText !== null && (
        <div role="alert" className="grid justify-items-start gap-1 text-sm text-owe">
          <p>{errorText}</p>
          {canRetry(errorText) && (
            <Button variant="link" onClick={() => regenerate()}>
              Probar de nuevo
            </Button>
          )}
        </div>
      )}
      <form
        className="sticky bottom-0 grid gap-1 bg-bg pb-1 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
      >
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">Tu pregunta</span>
            <input
              className={FIELD}
              value={text}
              maxLength={MAX_MESSAGE_CHARS}
              placeholder="Escribí tu pregunta"
              autoComplete="off"
              disabled={done}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || done || text.trim() === ""}>
            Mandar
          </Button>
        </div>
        {text.length >= 400 && (
          <p className="text-xs text-muted">
            {text.length} de {MAX_MESSAGE_CHARS}
          </p>
        )}
        {remainingText(remaining) !== null && errorText === null && <p className="text-xs text-muted">{remainingText(remaining)}</p>}
      </form>
    </div>
  );
}
