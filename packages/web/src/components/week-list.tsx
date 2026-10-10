import { formatPesos } from "../lib/format";
import type { FundView } from "../lib/fund-view";
import { Card, CardTitle } from "./ui";

/** The memorable thing (spec, 9.1): the members as in the match's WhatsApp list, who paid and who owes. */
export function WeekList({ view, justPaid = false }: { view: FundView; justPaid?: boolean }) {
  return (
    <Card>
      <CardTitle>Esta semana</CardTitle>
      <p className="money text-[13px] text-muted">Cuota de {formatPesos(view.weeklyFee)}</p>
      <ol className="mt-2">
        {view.rows.map((row) => (
          <li key={row.member} className="flex items-center gap-3 border-t border-line py-2.5">
            <span className="money w-6 text-xl font-bold text-num [font-stretch:75%]">{row.position}</span>
            <span className="flex-1 text-[15px] font-semibold">
              <span className={row.isMe ? "marked" : undefined}>
                {row.name}
                {row.isMe ? " (vos)" : ""}
              </span>
            </span>
            {row.owed === 0n ? (
              <span
                className={`grid size-[26px] place-items-center rounded-full bg-primary text-sm font-bold text-white ${row.isMe && justPaid ? "check-in" : ""}`}
                role="img"
                aria-label="pagó"
              >
                ✓
              </span>
            ) : (
              <span className="money text-[13px] font-semibold text-owe">debe {formatPesos(row.owed)}</span>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
