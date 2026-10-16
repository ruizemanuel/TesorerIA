"use client";

import { useMessages } from "../lib/i18n/client";
import { ShareButtons } from "./share-buttons";

/**
 * The invitation link, to copy or send by WhatsApp (spec, 9.2). WhatsApp is the primary button unless the
 * screen already has one (`variant="secondary"`): one primary per screen (spec, 9.1).
 */
export function ShareLink({ url, fundName, variant = "primary" }: { url: string; fundName: string; variant?: "primary" | "secondary" }) {
  const m = useMessages();
  return (
    <div className="grid gap-2">
      <p className="break-all rounded-[14px] bg-tint p-3 text-[13px]">{url}</p>
      <ShareButtons text={m.share.whatsApp(fundName, url)} copyText={url} copyLabel={m.share.copy} variant={variant} />
    </div>
  );
}
