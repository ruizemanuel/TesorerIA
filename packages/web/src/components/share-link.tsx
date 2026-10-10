"use client";

import { useState } from "react";
import { Button, ButtonLink } from "./ui";

/**
 * The invitation link, to copy or send by WhatsApp (spec, 9.2). WhatsApp is the primary button unless the
 * screen already has one (`variant="secondary"`): one primary per screen (spec, 9.1).
 */
export function ShareLink({ url, fundName, variant = "primary" }: { url: string; fundName: string; variant?: "primary" | "secondary" }) {
  const [copied, setCopied] = useState(false);
  const text = `Sumate al fondo "${fundName}" en TesorerIA: ${url}`;
  return (
    <div className="grid gap-2">
      <p className="break-all rounded-[14px] bg-tint p-3 text-[13px]">{url}</p>
      <div className="grid grid-cols-2 gap-2">
        <ButtonLink variant={variant} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          Mandar por WhatsApp
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
          {copied ? "Copiado" : "Copiar el link"}
        </Button>
      </div>
    </div>
  );
}
