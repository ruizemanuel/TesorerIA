"use client";

import { useState } from "react";
import { useMessages } from "../lib/i18n/client";
import { whatsAppLink } from "../lib/share";
import { Button, ButtonLink } from "./ui";

/**
 * The two ways to send something to the group (spec, 9.2 and 9.4): WhatsApp, opened with `text` already written, and a
 * button that copies `copyText` and says so ("Copiado"). WhatsApp is the primary button unless the screen already has
 * one (`variant="secondary"`): one primary per screen (spec, 9.1).
 */
export function ShareButtons({
  text,
  copyText,
  copyLabel,
  variant = "primary",
}: {
  text: string;
  copyText: string;
  copyLabel: string;
  variant?: "primary" | "secondary";
}) {
  const m = useMessages();
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid grid-cols-2 gap-2">
      <ButtonLink variant={variant} href={whatsAppLink(text)} target="_blank" rel="noreferrer">
        {m.share.send}
      </ButtonLink>
      <Button
        variant="secondary"
        onClick={() =>
          navigator.clipboard.writeText(copyText).then(
            () => setCopied(true),
            () => {}, // no clipboard (an old browser, no permission): what's to copy is on screen to copy by hand
          )
        }
      >
        {copied ? m.share.copied : copyLabel}
      </Button>
    </div>
  );
}
