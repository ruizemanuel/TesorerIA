"use client";

import Link from "next/link";
import { useId } from "react";
import type { Address } from "viem";
import { useAccountBalances } from "../lib/client/account";
import { USDT_SPECK, WARS_SPECK, formatPesos, formatUsdt } from "../lib/format";
import { type YourFund, fundTag } from "../lib/home";
import { useLocale, useMessages } from "../lib/i18n/client";
import { LanguageSwitch } from "./language-switch";
import { LogoutButton } from "./logout-button";
import { PanelLink } from "./panel-link";
import { buttonClass } from "./ui";

const LOOK_EVERY_MS = 30_000;

/**
 * Tu cuenta (spec, 9.2 and 9.4 C): who you entered as, what your own account holds (where the agent's reimbursements
 * land), the way to pass it to pesos when there are any, your funds and the way to create another, the language switch
 * and Salir.
 */
export function AccountPanel({ userName, account, funds }: { userName: string; account: Address; funds: readonly YourFund[] }) {
  const m = useMessages();
  const locale = useLocale();
  const { balances, failed } = useAccountBalances(account, LOOK_EVERY_MS);
  return (
    <div className="grid gap-4">
      <p>{m.account.loggedInAs(userName)}</p>
      <div className="grid gap-1 rounded-[14px] bg-surface p-4">
        {balances === null ? (
          <p className="text-muted">{failed ? m.account.readFailed : m.account.reading}</p>
        ) : (
          <>
            <p className="text-[24px] font-bold leading-tight [font-stretch:87%]">
              {balances.usdt >= USDT_SPECK
                ? m.account.holdsAnd(
                    <span className="money">{formatPesos(balances.wars, locale)}</span>,
                    <span className="money">{formatUsdt(balances.usdt, locale)}</span>,
                  )
                : m.account.holds(<span className="money">{formatPesos(balances.wars, locale)}</span>)}
            </p>
            <p className="text-sm text-muted">{m.account.reimbursementsLand}</p>
          </>
        )}
      </div>
      {balances !== null &&
        (balances.wars >= WARS_SPECK ? (
          <PanelLink href="?p=pesos" className={buttonClass("primary")}>
            {m.account.cashOut}
          </PanelLink>
        ) : (
          <p className="text-muted">{m.account.nothingYet}</p>
        ))}
      <YourFunds funds={funds} />
      <LanguageSwitch className="justify-center" />
      <LogoutButton />
    </div>
  );
}

/**
 * Tus fondos (spec, 9.4 C): one row per fund, the one on screen marked and without a link, drafts and open requests
 * with what they are, then "Crear otro fondo". Rows and a text link: "Pasar a pesos" stays the panel's one primary
 * button (spec, 9.1). The name and its tag share one span inside the flex row, so the space before the tag survives
 * and a long name wraps together with it.
 */
function YourFunds({ funds }: { funds: readonly YourFund[] }) {
  const m = useMessages();
  const heading = useId();
  const tag = (row: YourFund) => {
    const text = fundTag(row, m);
    return text === null ? null : <span className="font-normal text-muted">{text}</span>;
  };
  return (
    <section aria-labelledby={heading} className="grid gap-1">
      <h3 id={heading} className="text-sm font-semibold text-muted">
        {m.account.yourFunds}
      </h3>
      <ul className="grid">
        {funds.map((row) => (
          <li key={row.key}>
            {row.href === null ? (
              <p aria-current="page" className="flex min-h-11 items-center font-bold">
                <span>
                  {row.name}
                  {tag(row)}
                </span>
              </p>
            ) : (
              <Link href={row.href} className="flex min-h-11 items-center font-semibold text-primary">
                <span>
                  {row.name}
                  {tag(row)}
                </span>
              </Link>
            )}
          </li>
        ))}
      </ul>
      <Link href="/crear" className="flex min-h-11 items-center font-bold text-primary">
        {m.account.createAnother}
      </Link>
    </section>
  );
}
