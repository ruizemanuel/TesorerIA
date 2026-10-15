"use client";

import type { Address } from "viem";
import { useAccountBalances } from "../lib/client/account";
import { WARS_SPECK, heldAmounts } from "../lib/format";
import { useLocale, useMessages } from "../lib/i18n/client";
import { PanelLink } from "./panel-link";
import { buttonClass } from "./ui";

const LOOK_EVERY_MS = 30_000;

/**
 * "En tu cuenta tenés $ 1.016,10.": what reached the member's own account and isn't in the fund, so money that
 * arrived from Ripio or an exchange doesn't look lost before its Aportar. No "sin aportar": the agent's
 * reimbursements land there too, and those are the member's to keep. With pesos in it, "Pasar a pesos" opens that
 * panel (spec, 9.2), so passing a reimbursement on doesn't depend on knowing it's behind the avatar. Nothing while it
 * reads, if it can't, or if the account is empty; a pass reads it again at once (ACCOUNT_CHANGED).
 */
export function AccountHolding({ account }: { account: Address }) {
  const m = useMessages();
  const locale = useLocale();
  const { balances } = useAccountBalances(account, LOOK_EVERY_MS);
  if (balances === null) return null;
  const amounts = heldAmounts(balances, locale);
  if (amounts.length === 0) return null;
  return (
    <p className="mt-1 text-sm text-muted">
      {m.fund.inYourAccount(
        amounts.map((amount, i) => (
          <span key={amount}>
            {i > 0 && ` ${m.fund.and} `}
            <span className="money font-semibold text-ink">{amount}</span>
          </span>
        )),
      )}
      {balances.wars >= WARS_SPECK && (
        <>
          {" "}
          {/* A link-styled button: 44 px tall, so it's easy to tap inside the sentence (spec, 9.1). */}
          <PanelLink href="?p=pesos" className={buttonClass("link")}>
            {m.fund.cashOut}
          </PanelLink>
        </>
      )}
    </p>
  );
}
