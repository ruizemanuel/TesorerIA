import { formatPesos } from "../lib/format";
import type { FundView } from "../lib/fund-view";
import { Card, CardTitle } from "./ui";

/** The rules in plain words (spec, 9, Inicio): what the agent pays back alone, and that the rest is voted. */
export function RulesCard({ view }: { view: FundView }) {
  const members = view.rows.length;
  return (
    <Card>
      <CardTitle>Las reglas</CardTitle>
      <p className="mt-1.5">
        El agente devuelve hasta <span className="money">{formatPesos(view.weeklyCap)}</span> por semana por {view.agreedExpense}. Esta semana
        quedan <span className="money">{formatPesos(view.leftThisWeek)}</span>. Todo lo demás necesita {view.votesRequired} de {members} votos.
        Nadie puede cambiar esto solo, ni el agente.
      </p>
    </Card>
  );
}
