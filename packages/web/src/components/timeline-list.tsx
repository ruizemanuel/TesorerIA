import { useId } from "react";
import type { Address } from "viem";
import { formatWhen } from "../lib/format";
import type { Locale } from "../lib/i18n/locales";
import type { Messages } from "../lib/i18n/messages";
import type { TimelineItem } from "../lib/timeline";
import { Avatar } from "./avatar";
import { ExecuteButton } from "./execute-button";
import { PanelLink } from "./panel-link";
import { ProposeMemberButton } from "./propose-member-button";
import { buttonClass } from "./ui";
import { VoteButton } from "./vote-button";

/** The movements, newest first (spec, 9.2): avatar, one sentence (with a heads-up under it, when Proponer sumarlo has one), the time, and at most one action. */
export function TimelineList({
  items,
  fund,
  fundName,
  now,
  readOnly = false,
  closed = false,
  basePath = "",
  viewerName = "",
  m,
  locale,
}: {
  items: readonly TimelineItem[];
  fund: Address;
  fundName: string;
  now: Date;
  readOnly?: boolean;
  /** The fund has been closed: its proposals can no longer be voted. */
  closed?: boolean;
  /** Where the comprobante and Aportar open: "" for this page, or the inicio's path from Movimientos. */
  basePath?: string;
  /** Whose initials your own operations on their way wear: the timeline names their actor "Vos" ("You" in English). */
  viewerName?: string;
  m: Messages;
  locale: Locale;
}) {
  // Each sentence's id, for the links under it to say what they're about: the inicio shows the list twice (phone, desktop).
  const listId = useId();
  if (items.length === 0) {
    return (
      <div className="grid justify-items-start py-1">
        <p className="py-2 text-muted">{m.movements.empty}</p>
        {!readOnly && (
          <PanelLink href={`${basePath}?p=aportar`} className={buttonClass("link")}>
            {m.fund.contribute}
          </PanelLink>
        )}
      </div>
    );
  }
  return (
    <ol>
      {items.map((item, i) => {
        const { actor } = item;
        // Only your own operations are pending and by a member (the agent's expenses are by the agent).
        const who = item.pending && actor.kind === "member" ? viewerName : actor.kind === "member" ? actor.name : fundName;
        // Proponer sumarlo, when it is offered here: its heads-up (the requester's name is someone else's) shows exactly then.
        const proposeMember = item.action?.kind === "propose-member" && !readOnly && !closed && item.action.canPropose ? item.action : null;
        const sentence = `${listId}-${i}`;
        return (
          <li key={item.id} className="flex gap-3 border-t border-line py-3 first:border-t-0">
            <Avatar kind={actor.kind === "agent" ? "agent" : "member"} name={who} />
            <div className="min-w-0 flex-1">
              <p id={sentence} className="text-sm leading-snug [font-variant-numeric:lining-nums_tabular-nums]">
                {item.text}
              </p>
              {proposeMember?.headsUp && <p className="mt-0.5 text-[13px] leading-snug text-muted">{proposeMember.headsUp}</p>}
              <p className="mt-0.5 text-xs text-muted">{item.pending ? m.movements.onItsWay : formatWhen(item.at, now, locale)}</p>
              {item.action?.kind === "receipt" && (
                // 44 px to tap, all of them inside its own row: a box down to the divider read as the next row's.
                <PanelLink
                  href={`${basePath}?p=comprobante&id=${encodeURIComponent(item.id)}`}
                  aria-describedby={sentence}
                  className="-mt-1.5 inline-flex min-h-11 items-center text-[13px] font-bold text-primary"
                >
                  {m.movements.viewReceipt}
                </PanelLink>
              )}
              {item.action?.kind === "summary" && (
                <PanelLink
                  href={`${basePath}?p=resumen&semana=${item.action.week + 1}`}
                  aria-describedby={sentence}
                  className="-mt-1.5 inline-flex min-h-11 items-center text-[13px] font-bold text-primary"
                >
                  {m.movements.viewSummary}
                </PanelLink>
              )}
              {item.action?.kind === "vote" && !readOnly && !closed && item.action.canVote && (
                <VoteButton fund={fund} proposalId={item.action.proposalId.toString()} completes={item.action.completes} />
              )}
              {item.action?.kind === "vote" && !readOnly && item.action.voted && (
                <p className="mt-1 text-[13px] font-semibold text-muted">{m.movements.voted}</p>
              )}
              {item.action?.kind === "execute" && !readOnly && !closed && item.action.canExecute && (
                <ExecuteButton fund={fund} proposalId={item.action.proposalId.toString()} />
              )}
              {proposeMember && <ProposeMemberButton fund={fund} account={proposeMember.account} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
