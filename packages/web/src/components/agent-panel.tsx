"use client";

import dynamic from "next/dynamic";

/**
 * The Agente panel's content: the chat (ChatPanel), loaded the first time the panel opens. The AI SDK it needs, some
 * 85 KB compressed, stays out of every fund page's first load, and the public view, which has no chat, never loads it.
 * Until it's in, quiet gray blocks in the shape of the greeting (spec, 9.2).
 */
export const AgentPanel = dynamic(() => import("./chat-panel").then((module) => module.ChatPanel), {
  loading: () => (
    <div role="status" aria-busy="true" aria-label="Cargando" className="flex gap-2">
      <span className="size-8 flex-none rounded-full bg-line" />
      <span className="h-12 flex-1 rounded-[14px] bg-line" />
    </div>
  ),
});
