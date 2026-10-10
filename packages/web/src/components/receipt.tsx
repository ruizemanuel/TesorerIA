import { formatWhen } from "../lib/format";
import type { TimelineItem } from "../lib/timeline";

/** The comprobante (spec, 9.2): what happened, why, and the only link to the chain. */
export function Receipt({ item, now }: { item: TimelineItem; now: Date }) {
  const tx = item.action?.kind === "receipt" ? item.action.tx : undefined;
  return (
    <div className="grid gap-3 rounded-[14px] bg-surface p-4">
      <p className="text-[15px] font-semibold [font-variant-numeric:lining-nums_tabular-nums]">{item.text}</p>
      {item.detail && <p className="text-sm">{item.detail}</p>}
      <p className="text-xs text-muted">{formatWhen(item.at, now)}</p>
      {tx && (
        <a
          className="inline-flex min-h-11 items-center text-[13px] font-bold text-primary"
          href={`https://celo.blockscout.com/tx/${tx}`}
          target="_blank"
          rel="noreferrer"
        >
          Ver en el explorador de Celo
        </a>
      )}
    </div>
  );
}
