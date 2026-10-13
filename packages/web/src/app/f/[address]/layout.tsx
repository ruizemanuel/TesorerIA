import type { ReactNode } from "react";
import { ChatProvider } from "../../../components/chat-provider";
import { RefreshProvider } from "../../../components/refresh-provider";

/**
 * A fund's pages share its chat (spec, 9.2): it lives here, so it outlasts the panel and the move to Movimientos.
 * Only its holder does: the AI SDK comes with the Agente panel, the first time it opens (agent-panel.tsx). They also
 * share their refresh, so a panel knows when one is on its way (RefreshProvider).
 */
export default async function FundLayout({ children, params }: { children: ReactNode; params: Promise<{ address: string }> }) {
  const { address } = await params;
  // Keyed by the fund: another fund gets its own conversation.
  return (
    <RefreshProvider>
      <ChatProvider key={address.toLowerCase()} fund={address}>
        {children}
      </ChatProvider>
    </RefreshProvider>
  );
}
