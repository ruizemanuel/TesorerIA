"use client";

import type { Chat } from "@ai-sdk/react";
import { type ReactNode, createContext, useContext, useState } from "react";
import type { ChatUIMessage } from "../lib/chat/tools";

/**
 * The fund's conversation with its agent (spec, 9.2): one per fund and per page load, kept above the pages and the
 * panel, so closing the panel or going to Movimientos keeps it, and reloading starts a new one. Its Chat is made by
 * the panel the first time it opens (chat-panel.tsx), which brings the AI SDK with it: this module only holds it, so
 * no page carries the SDK in its first load.
 */
export type FundConversation = {
  fund: string;
  chat: Chat<ChatUIMessage> | null;
  /** The tool calls of the cards whose expense is being loaded right now: a new message must not dismiss them. */
  confirming: Set<string>;
};

const FundChat = createContext<FundConversation | null>(null);

/** Holds the fund's conversation (FundConversation). The cards being confirmed live here too: closing the panel in the middle of a confirmation unmounts the card. */
export function ChatProvider({ fund, children }: { fund: string; children: ReactNode }) {
  const [conversation] = useState<FundConversation>(() => ({ fund, chat: null, confirming: new Set() }));
  return <FundChat value={conversation}>{children}</FundChat>;
}

export function useFundConversation(): FundConversation {
  const conversation = useContext(FundChat);
  if (conversation === null) throw new Error("useFundConversation must be used inside ChatProvider");
  return conversation;
}

/** The cards being confirmed (see FundConversation): the card adds its tool call around its request, the panel reads it. */
export function useConfirmingCards(): Set<string> {
  return useFundConversation().confirming;
}
