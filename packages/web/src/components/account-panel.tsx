"use client";

import type { Address } from "viem";
import { useAccountBalances } from "../lib/client/account";
import { USDT_SPECK, WARS_SPECK, formatPesos, formatUsdt } from "../lib/format";
import { useLocale, useMessages } from "../lib/i18n/client";
import { LanguageSwitch } from "./language-switch";
import { LogoutButton } from "./logout-button";
import { PanelLink } from "./panel-link";
import { buttonClass } from "./ui";

const LOOK_EVERY_MS = 30_000;

/**
 * Tu cuenta (spec, 9.2): who you entered as, what your own account holds (where the agent's reimbursements land),
 * the way to pass it to pesos when there are any, the language switch and Salir.
 */
export function AccountPanel({ userName, account }: { userName: string; account: Address }) {
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
      <LanguageSwitch className="justify-center" />
      <LogoutButton />
    </div>
  );
}
