"use client";

import { useMessages } from "../lib/i18n/client";
import { ShareButtons } from "./share-buttons";

/**
 * A week's summary (spec, 9.4): the text exactly as it goes to the group, and the two ways to send it, "Mandar por
 * WhatsApp" (the panel's one primary) and "Copiar". Both take this same `text`, so what goes out is what's on screen.
 * The public view shows the text alone (`shareable` false).
 */
export function SummaryPanel({ text, shareable }: { text: string; shareable: boolean }) {
  const m = useMessages();
  return (
    <div className="grid gap-3">
      <p className="whitespace-pre-wrap break-words rounded-[14px] bg-surface p-4 text-[15px] leading-snug [font-variant-numeric:lining-nums_tabular-nums]">
        {text}
      </p>
      {shareable && <ShareButtons text={text} copyText={text} copyLabel={m.summary.copy} />}
    </div>
  );
}
