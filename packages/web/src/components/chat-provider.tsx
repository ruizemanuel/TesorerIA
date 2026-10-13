"use client";

import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { type ReactNode, createContext, useContext, useState } from "react";
import { MAX_HISTORY_MESSAGES } from "../lib/chat/limits";
import type { ChatUIMessage } from "../lib/chat/tools";

type FundConversation = {
  chat: Chat<ChatUIMessage>;
  /** The tool calls of the cards whose expense is being loaded right now: a new message must not dismiss them. */
  confirming: Set<string>;
};

const FundChat = createContext<FundConversation | null>(null);

/**
 * The fund's conversation with its agent (spec, 9.2): one per fund and per page load, kept above the pages and the
 * panel, so closing the panel or going to Movimientos keeps it, and reloading starts a new one. useChat given this
 * instance never stops it on unmount. Only the last messages are sent: the route keeps no more (spec, 8.2).
 * The cards being confirmed are kept here too: closing the panel in the middle of a confirmation unmounts the card.
 */
export function ChatProvider({ fund, children }: { fund: string; children: ReactNode }) {
  const [conversation] = useState<FundConversation>(() => ({
    chat: new Chat<ChatUIMessage>({
      id: fund,
      transport: new DefaultChatTransport({
        api: `/api/funds/${fund}/chat`,
        prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: messages.slice(-MAX_HISTORY_MESSAGES) } }),
      }),
    }),
    confirming: new Set(),
  }));
  return <FundChat value={conversation}>{children}</FundChat>;
}

function useConversation(): FundConversation {
  const conversation = useContext(FundChat);
  if (conversation === null) throw new Error("useFundChat must be used inside ChatProvider");
  return conversation;
}

export function useFundChat(): Chat<ChatUIMessage> {
  return useConversation().chat;
}

/** The cards being confirmed (see FundConversation): the card adds its tool call around its request, the panel reads it. */
export function useConfirmingCards(): Set<string> {
  return useConversation().confirming;
}
