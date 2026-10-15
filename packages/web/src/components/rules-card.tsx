import { formatPesos } from "../lib/format";
import type { FundView } from "../lib/fund-view";
import type { Locale } from "../lib/i18n/locales";
import type { Messages } from "../lib/i18n/messages";
import { Card, CardTitle } from "./ui";

/** The rules in plain words (spec, 9, Inicio): what the agent pays back alone, and that the rest is voted. */
export function RulesCard({ view, m, locale }: { view: FundView; m: Messages; locale: Locale }) {
  const members = view.rows.length;
  const money = (units: bigint) => <span className="money">{formatPesos(units, locale)}</span>;
  return (
    <Card>
      <CardTitle>{m.rules.title}</CardTitle>
      <p className="mt-1.5">{m.rules.text(money(view.weeklyCap), view.agreedExpense, money(view.leftThisWeek), view.votesRequired, members)}</p>
    </Card>
  );
}
