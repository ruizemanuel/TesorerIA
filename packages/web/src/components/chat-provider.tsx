"use client";

import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { type ReactNode, createContext, useContext, useState } from "react";
import { MAX_HISTORY_MESSAGES } from "../lib/chat/limits";
import type { ChatUIMessage } from "../lib/chat/tools";

const FundChat = createContext<Chat<ChatUIMessage> | null>(null);

/**
 * The fund's conversation with its agent (spec, 9.2): one per fund and per page load, kept above the pages and the
 * panel, so closing the panel or going to Movimientos keeps it, and reloading starts a new one. useChat given this
 * instance never stops it on unmount. Only the last messages are sent: the route keeps no more (spec, 8.2).
 */
export function ChatProvider({ fund, children }: { fund: string; children: ReactNode }) {
  const [chat] = useState(
    () =>
      new Chat<ChatUIMessage>({
        id: fund,
        transport: new DefaultChatTransport({
          api: `/api/funds/${fund}/chat`,
          prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: messages.slice(-MAX_HISTORY_MESSAGES) } }),
        }),
      }),
  );
  return <FundChat value={chat}>{children}</FundChat>;
}

export function useFundChat(): Chat<ChatUIMessage> {
  const chat = useContext(FundChat);
  if (chat === null) throw new Error("useFundChat must be used inside ChatProvider");
  return chat;
}
