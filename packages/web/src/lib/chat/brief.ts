import { TIME_ZONE, formatPesos, formatWhen } from "../format";
import type { FundView } from "../fund-view";
import type { FundScreen } from "../read-fund";
import type { TimelineItem } from "../timeline";

/** The tag the brief comes in: the instructions say everything inside it is data (spec, 8.2). */
export const BRIEF_TAG = "estado_del_fondo";
/** The newest movements the brief carries: about 2.000 tokens in all. */
export const BRIEF_MOVEMENTS = 50;

/**
 * Text a member wrote (a name, a note, the agreed expense), as the brief carries it: on one line, so it can't make up
 * a line of its own; with ‹ › for < >, so it can't close the brief's tag; and with no full address in it.
 */
export function briefText(text: string): string {
  // `\s` also matches the no-break space that formatPesos puts in "$ 50": keep it, so amounts read as they do on screen.
  return text
    .replace(/[^\S ]+/g, " ")
    .replaceAll("<", "‹")
    .replaceAll(">", "›")
    .replace(/0x[0-9a-fA-F]{40}/g, "una cuenta")
    .trim();
}

function who(item: TimelineItem): string {
  if (item.actor.kind === "agent") return "El agente";
  if (item.actor.kind === "group") return "El grupo";
  return item.actor.name;
}

function movement(item: TimelineItem, now: Date): string {
  const when = item.pending ? "En camino" : formatWhen(item.at, now);
  const why = item.detail ? ` Motivo: ${item.detail}` : "";
  const voted = item.action?.kind === "vote" && item.action.voted ? " Ya la votaste." : "";
  return `- ${when}. ${briefText(`${who(item)}: ${item.text}${why}${voted}`)}`;
}

function yours(view: FundView): string[] {
  if (view.me === null) return [];
  const standing =
    view.me.owed > 0n
      ? `Debés ${formatPesos(view.me.owed)}.`
      : view.me.ahead > 0n
        ? `Estás al día, con ${formatPesos(view.me.ahead)} adelantados.`
        : "Estás al día.";
  return [`Tu situación: ${standing} Si el fondo se cerrara hoy, te tocarían ${formatPesos(view.me.share)}.`];
}

/**
 * The fund as `viewerName` sees it on their screen, in plain Spanish, for the chat's model (spec, 8.2): the same
 * numbers and sentences, so the model can't contradict the screen. No address goes in it, only names.
 */
export function fundBrief(screen: FundScreen, viewerName: string, now: Date): string {
  const { view, timeline } = screen;
  const today = new Intl.DateTimeFormat("es-AR", {
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
      ? "Movimientos: todavía no hay."
      : timeline.length > BRIEF_MOVEMENTS
        ? `Movimientos, del más nuevo al más viejo (los ${BRIEF_MOVEMENTS} más nuevos de ${timeline.length}; los anteriores no los ves):`
        : "Movimientos, del más nuevo al más viejo:";
  return [
    `<${BRIEF_TAG}>`,
    `Ahora es ${today}, hora de Argentina. El fondo va por su semana ${view.week + 1n}.`,
    `Fondo: ${briefText(view.name)}. Saldo: ${formatPesos(view.balance)}.${view.closed ? " El fondo está cerrado." : ""}`,
    `Reglas: cada uno pone ${formatPesos(view.weeklyFee)} por semana. El agente devuelve hasta ${formatPesos(view.weeklyCap)} por semana por ${briefText(view.agreedExpense)}, el gasto acordado: esta semana devolvió ${formatPesos(view.spentThisWeek)} y quedan ${formatPesos(view.leftThisWeek)}. Todo lo demás necesita ${view.votesRequired} de ${view.rows.length} votos. Nadie puede cambiar esto solo, ni el agente.`,
    `Te habla: ${briefText(viewerName)}.`,
    ...yours(view),
    "La lista de la semana, en el orden en que entraron:",
    ...view.rows.map(
      (row) => `${row.position}. ${briefText(row.name)}${row.isMe ? " (vos)" : ""}: ${row.owed === 0n ? "pagó" : `debe ${formatPesos(row.owed)}`}.`,
    ),
    open.length === 0 ? "Propuestas abiertas: ninguna." : "Propuestas abiertas:",
    ...open.map((item) => movement(item, now)),
    movementsTitle,
    ...shown.map((item) => movement(item, now)),
    `</${BRIEF_TAG}>`,
  ].join("\n");
}
