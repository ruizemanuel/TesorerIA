import Link from "next/link";
import { formatWhen } from "../lib/format";
import type { TimelineItem } from "../lib/timeline";
import { Avatar } from "./avatar";
import { ButtonLink } from "./ui";

/** The movements, newest first (spec, 9.2): avatar, one sentence, the time, and at most one action. */
export function TimelineList({
  items,
  fundName,
  now,
  readOnly = false,
  basePath = "",
  viewerName = "",
}: {
  items: readonly TimelineItem[];
  fundName: string;
  now: Date;
  readOnly?: boolean;
  /** Where the comprobante and Aportar open: "" for this page, or the inicio's path from Movimientos. */
  basePath?: string;
  /** Whose initials your own operations on their way wear: the timeline names their actor "Vos". */
  viewerName?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="grid justify-items-start py-1">
        <p className="py-2 text-muted">Todavía no hay movimientos. El primero puede ser tu aporte.</p>
        {!readOnly && (
          <ButtonLink href={`${basePath}?p=aportar`} variant="link" scroll={false}>
            Aportar
          </ButtonLink>
        )}
      </div>
    );
  }
  return (
    <ol>
      {items.map((item) => {
        const { actor } = item;
        // Only your own operations are pending and by a member (the agent's expenses are by the agent).
        const who = item.pending && actor.kind === "member" ? viewerName : actor.kind === "member" ? actor.name : fundName;
        return (
          <li key={item.id} className="flex gap-3 border-t border-line py-3 first:border-t-0">
            <Avatar kind={actor.kind === "agent" ? "agent" : "member"} name={who} />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug [font-variant-numeric:lining-nums_tabular-nums]">{item.text}</p>
              <p className="mt-0.5 text-xs text-muted">{item.pending ? "En camino" : formatWhen(item.at, now)}</p>
              {item.action?.kind === "receipt" && (
                // 44 px to tap: the box reaches down to the row's divider instead of making the row taller.
                <Link
                  href={`${basePath}?p=comprobante&id=${encodeURIComponent(item.id)}`}
                  scroll={false}
                  className="-mb-3 -mt-1.5 inline-flex min-h-11 items-center text-[13px] font-bold text-primary"
                >
                  Ver comprobante
                </Link>
              )}
              {item.action?.kind === "vote" && !readOnly && item.action.voted && (
                <p className="mt-1 text-[13px] font-semibold text-muted">Votaste</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
