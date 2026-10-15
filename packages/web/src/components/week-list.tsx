import { formatPesos } from "../lib/format";
import type { FundView } from "../lib/fund-view";
import type { Locale } from "../lib/i18n/locales";
import type { Messages } from "../lib/i18n/messages";
import { Card, CardTitle } from "./ui";

/** The memorable thing (spec, 9.1): the members as in the match's WhatsApp list, who paid and who owes. */
export function WeekList({ view, justPaid = false, m, locale }: { view: FundView; justPaid?: boolean; m: Messages; locale: Locale }) {
  return (
    <Card>
      <CardTitle>{m.week.title}</CardTitle>
      <p className="money text-[13px] text-muted">{m.week.dues(formatPesos(view.weeklyFee, locale))}</p>
      <ol className="mt-2">
        {view.rows.map((row) => (
          <li key={row.member} className="flex items-center gap-3 border-t border-line py-2.5">
            <span className="money w-6 text-xl font-bold text-num [font-stretch:75%]">{row.position}</span>
            <span className="flex-1 text-[15px] font-semibold">
              <span className={row.isMe ? "marked" : undefined}>
                {row.name}
                {row.isMe ? m.common.you : ""}
              </span>
            </span>
            {row.owed === 0n ? (
              <span
                className={`grid size-[26px] place-items-center rounded-full bg-primary text-sm font-bold text-white ${row.isMe && justPaid ? "check-in" : ""}`}
                role="img"
                aria-label={m.week.paid}
              >
                ✓
              </span>
            ) : (
              <span className="money text-[13px] font-semibold text-owe">{m.week.owes(formatPesos(row.owed, locale))}</span>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
