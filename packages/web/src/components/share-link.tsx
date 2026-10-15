"use client";

import { useState } from "react";
import { useMessages } from "../lib/i18n/client";
import { Button, ButtonLink } from "./ui";

/**
 * The invitation link, to copy or send by WhatsApp (spec, 9.2). WhatsApp is the primary button unless the
 * screen already has one (`variant="secondary"`): one primary per screen (spec, 9.1).
 */
export function ShareLink({ url, fundName, variant = "primary" }: { url: string; fundName: string; variant?: "primary" | "secondary" }) {
  const m = useMessages();
  const [copied, setCopied] = useState(false);
  const text = m.share.whatsApp(fundName, url);
  return (
    <div className="grid gap-2">
      <p className="break-all rounded-[14px] bg-tint p-3 text-[13px]">{url}</p>
      <div className="grid grid-cols-2 gap-2">
        <ButtonLink variant={variant} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          {m.share.send}
        </ButtonLink>
        <Button
          variant="secondary"
          onClick={() =>
            navigator.clipboard.writeText(url).then(
              () => setCopied(true),
              () => {}, // no clipboard (an old browser, no permission): the link is on screen to copy by hand
            )
          }
        >
          {copied ? m.share.copied : m.share.copy}
        </Button>
      </div>
    </div>
  );
}
