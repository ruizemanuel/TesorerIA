import type { Address } from "viem";
import { formatPesos } from "../lib/format";
import type { FundView } from "../lib/fund-view";
import type { Locale } from "../lib/i18n/locales";
import type { Messages } from "../lib/i18n/messages";
import { AccountHolding } from "./account-holding";
import { FundNameRow } from "./bars";
import { CountUp } from "./count-up";
import { PanelLink } from "./panel-link";
import { buttonClass } from "./ui";

/**
 * The balance, your status, what's in your own account (`account`; never in the public view) and the two actions:
 * Aportar and Cargar gasto (spec, 9.2, Inicio 1–2). Up to 1023 px it's the white band under the screen's top, over
 * the 4 px stripe; from 1024 px, a card (the stripe is the top bar's).
 */
export function FundHeader({
  view,
  readOnly,
  previousBalance,
  userName,
  account,
  m,
  locale,
}: {
  view: FundView;
  readOnly: boolean;
  previousBalance?: bigint;
  userName?: string;
  account?: Address;
  m: Messages;
  locale: Locale;
}) {
  const { me } = view;
  const money = (units: bigint) => <span className="money">{formatPesos(units, locale)}</span>;
  return (
    <section className="border-b-4 border-primary bg-surface lg:rounded-[14px] lg:border-b-0">
      <div className="mx-auto max-w-[560px] px-4 pb-5 pt-1.5 lg:max-w-none lg:p-5">
        <div className="lg:hidden">
          <FundNameRow fundName={view.name} address={view.address} userName={userName} m={m} />
        </div>
        {/* The label first, as wallet apps do, so the balance doesn't read as "$ X en el fondo. Estás al día…" */}
        <p className="mt-1 text-sm text-muted lg:mt-0">{m.fund.inFund}</p>
        <p className="narrow money mt-1 text-[50px] font-bold leading-none lg:text-[52px]">
          {previousBalance === undefined ? formatPesos(view.balance, locale) : <CountUp from={previousBalance} to={view.balance} />}
        </p>
        {me !== null && (
          <>
            {/* One idea per line: where you stand, then your share. */}
            <p className={`mt-2 font-semibold ${me.owed === 0n ? "text-ink" : "text-owe"}`}>
              {me.owed > 0n ? m.fund.owe(money(me.owed)) : me.ahead > 0n ? m.fund.upToDateAhead(money(me.ahead)) : m.fund.upToDate}
            </p>
            <p className="mt-0.5 text-sm text-muted">{m.fund.share(money(me.share))}</p>
          </>
        )}
        {/* Keyed on the fund's balance: a contribution changes it, and the line reads the account again at once. */}
        {!readOnly && account !== undefined && <AccountHolding key={view.balance.toString()} account={account} />}
        {!readOnly && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <PanelLink href="?p=aportar" className={buttonClass("primary")}>
              {m.fund.contribute}
            </PanelLink>
            <PanelLink href="?p=gasto" className={buttonClass("secondary")}>
              {m.fund.addExpense}
            </PanelLink>
          </div>
        )}
      </div>
    </section>
  );
}
