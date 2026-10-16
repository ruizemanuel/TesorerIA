import { TIME_ZONE, formatPesos, formatWhen, intlLocale } from "../format";
import type { FundView } from "../fund-view";
import type { Messages } from "../i18n/messages";
import type { FundScreen } from "../read-fund";
import type { TimelineItem } from "../timeline";

/** The tag the brief comes in: the instructions say everything inside it is data (spec, 8.2). */
export const BRIEF_TAG = "estado_del_fondo";
/** The newest movements the brief carries: about 2.000 tokens in all. */
export const BRIEF_MOVEMENTS = 50;

/**
 * Text that anyone in the timeline wrote (a member's note or the agreed expense, or the self-chosen name of someone
 * who only has the fund's link, as in a join request), as the brief carries it: on one line, so it can't make up a
 * line of its own; with ‹ › for < >, so it can't close the brief's tag; and with no full address in it (the page's
 * language says what it becomes).
 */
export function briefText(text: string, m: Messages): string {
  // `\s` also matches the no-break space that formatPesos puts in "$ 50": keep it, so amounts read as they do on screen.
  return text
    .replace(/[^\S ]+/g, " ")
    .replaceAll("<", "‹")
    .replaceAll(">", "›")
    .replace(/0x[0-9a-fA-F]{40}/g, m.chat.brief.account)
    .trim();
}

function who(item: TimelineItem, m: Messages): string {
  if (item.actor.kind === "agent") return m.chat.brief.agent;
  if (item.actor.kind === "group") return m.chat.brief.group;
  return item.actor.name;
}

function movement(item: TimelineItem, now: Date, m: Messages): string {
  const when = item.pending ? m.movements.onItsWay : formatWhen(item.at, now, m.locale);
  const why = item.detail ? m.chat.brief.reason(item.detail) : "";
  const voted = item.action?.kind === "vote" && item.action.voted ? m.chat.brief.youVoted : "";
  return `- ${when}. ${briefText(`${who(item, m)}: ${item.text}${why}${voted}`, m)}`;
}

function yours(view: FundView, m: Messages): string[] {
  if (view.me === null) return [];
  const { brief } = m.chat;
  const standing =
    view.me.owed > 0n
      ? brief.owe(formatPesos(view.me.owed, m.locale))
      : view.me.ahead > 0n
        ? brief.upToDateAhead(formatPesos(view.me.ahead, m.locale))
        : brief.upToDate;
  return [brief.situation(standing, formatPesos(view.me.share, m.locale))];
}

/**
 * The fund as `viewerName` sees it on their screen, in the page's language, for the chat's model (spec, 8.2 and 9.3):
 * the same numbers and sentences, so the model can't contradict the screen. No address goes in it, only names.
 */
export function fundBrief(screen: FundScreen, viewerName: string, now: Date, m: Messages): string {
  const { view, timeline } = screen;
  const { brief } = m.chat;
  const { locale } = m;
  const today = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const open = timeline.filter((item) => item.action?.kind === "vote" || item.action?.kind === "execute");
  const shown = timeline.slice(0, BRIEF_MOVEMENTS);
  const movementsTitle =
    timeline.length === 0
      ? brief.noMovements
      : timeline.length > BRIEF_MOVEMENTS
        ? brief.movementsCut(BRIEF_MOVEMENTS, timeline.length)
        : brief.movements;
  const pesos = (units: bigint) => formatPesos(units, locale);
  return [
    `<${BRIEF_TAG}>`,
    brief.now(today, String(view.week + 1n)),
    `${brief.fund(briefText(view.name, m), pesos(view.balance))}${view.closed ? brief.closed : ""}`,
    brief.rules(
      pesos(view.weeklyFee),
      pesos(view.weeklyCap),
      briefText(view.agreedExpense, m),
      pesos(view.spentThisWeek),
      pesos(view.leftThisWeek),
      view.votesRequired,
      view.rows.length,
    ),
    brief.speaking(briefText(viewerName, m)),
    ...yours(view, m),
    brief.weekList,
    ...view.rows.map(
      (row) => `${row.position}. ${briefText(row.name, m)}${row.isMe ? m.common.you : ""}: ${row.owed === 0n ? m.week.paid : m.week.owes(pesos(row.owed))}.`,
    ),
    open.length === 0 ? brief.noProposals : brief.proposals,
    ...open.map((item) => movement(item, now, m)),
    movementsTitle,
    ...shown.map((item) => movement(item, now, m)),
    `</${BRIEF_TAG}>`,
  ].join("\n");
}
