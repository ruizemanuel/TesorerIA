import type { FundView } from "../lib/fund-view";
import type { Locale } from "../lib/i18n/locales";
import type { Messages } from "../lib/i18n/messages";
import { Card, Money } from "./ui";

/**
 * The portada's rules (spec, 9.2), with the real group's fund's own numbers: what the agent does on its own, what takes
 * a vote, that the money is in the fund's contract (linked, not the FundFactory), and what happens if you leave.
 */
export function HomeRules({ view, m, locale }: { view: FundView; m: Messages; locale: Locale }) {
  const r = m.home.rules;
  const contract = (
    <a className="font-semibold text-primary" href={`https://celo.blockscout.com/address/${view.address}`}>
      {r.contractLink}
    </a>
  );
  return (
    <Card className="grid gap-2">
      <h2 className="text-lg font-bold [font-stretch:87%]">{r.title}</h2>
      <p>{r.alone(view.agreedExpense, <Money units={view.weeklyCap} locale={locale} />)}</p>
      {/* FundView has no member count: the week's list has a row per member. */}
      <p>{r.vote(view.name, view.votesRequired, view.rows.length)}</p>
      <p>{r.money(contract)}</p>
      <p>{r.leaving}</p>
    </Card>
  );
}
