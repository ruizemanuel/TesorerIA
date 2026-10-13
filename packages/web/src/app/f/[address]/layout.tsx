import type { ReactNode } from "react";
import { ChatProvider } from "../../../components/chat-provider";

/** A fund's pages share its chat (spec, 9.2): it lives here, so it outlasts the panel and the move to Movimientos. */
export default async function FundLayout({ children, params }: { children: ReactNode; params: Promise<{ address: string }> }) {
  const { address } = await params;
  // Keyed by the fund: another fund gets its own conversation.
  return (
    <ChatProvider key={address.toLowerCase()} fund={address}>
      {children}
    </ChatProvider>
  );
}
