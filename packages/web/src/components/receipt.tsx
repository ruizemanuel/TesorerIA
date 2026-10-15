import type { ReactNode } from "react";
import { formatWhen } from "../lib/format";
import type { Locale } from "../lib/i18n/locales";
import type { Messages } from "../lib/i18n/messages";
import type { TimelineItem } from "../lib/timeline";

/** Each movement's comprobante, by its id, for the ones the timeline links to (PanelHost). */
export function receiptPanels(items: readonly TimelineItem[], now: Date, m: Messages, locale: Locale): Record<string, ReactNode> {
  return Object.fromEntries(
    items.filter((item) => item.action?.kind === "receipt").map((item) => [item.id, <Receipt item={item} now={now} m={m} locale={locale} />]),
  );
}

/** The comprobante (spec, 9.2): what happened, why, and the only link to the chain. */
export function Receipt({ item, now, m, locale }: { item: TimelineItem; now: Date; m: Messages; locale: Locale }) {
  const tx = item.action?.kind === "receipt" ? item.action.tx : undefined;
  return (
    <div className="grid gap-3 rounded-[14px] bg-surface p-4">
      <p className="text-[15px] font-semibold [font-variant-numeric:lining-nums_tabular-nums]">{item.text}</p>
      {item.detail && <p className="text-sm">{item.detail}</p>}
      <p className="text-xs text-muted">{formatWhen(item.at, now, locale)}</p>
      {tx && (
        <a
          className="inline-flex min-h-11 items-center text-[13px] font-bold text-primary"
          href={`https://celo.blockscout.com/tx/${tx}`}
          target="_blank"
          rel="noreferrer"
        >
          {m.receipt.viewOnExplorer}
        </a>
      )}
    </div>
  );
}
