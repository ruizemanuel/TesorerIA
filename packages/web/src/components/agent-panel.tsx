"use client";

import dynamic from "next/dynamic";
import { useMessages } from "../lib/i18n/client";

/** The greeting's shape in quiet gray blocks, named for screen readers in the page's language. */
function AgentPanelLoading() {
  const m = useMessages();
  return (
    <div role="status" aria-busy="true" aria-label={m.fund.loading} className="flex gap-2">
      <span className="size-8 flex-none rounded-full bg-line" />
      <span className="h-12 flex-1 rounded-[14px] bg-line" />
    </div>
  );
}

/**
 * The Agente panel's content: the chat (ChatPanel), loaded the first time the panel opens. The AI SDK it needs, some
 * 85 KB compressed, stays out of every fund page's first load, and the public view, which has no chat, never loads it.
 * Until it's in, quiet gray blocks in the shape of the greeting (spec, 9.2).
 */
export const AgentPanel = dynamic(() => import("./chat-panel").then((module) => module.ChatPanel), {
  loading: AgentPanelLoading,
});
