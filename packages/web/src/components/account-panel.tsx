"use client";

import type { Address } from "viem";
import { useAccountBalances } from "../lib/client/account";
import { USDT_SPECK, WARS_SPECK, formatPesos, formatUsdt } from "../lib/format";
import { LogoutButton } from "./logout-button";
import { PanelLink } from "./panel-link";
import { buttonClass } from "./ui";

const LOOK_EVERY_MS = 30_000;

/**
 * Tu cuenta (spec, 9.2): who you entered as, what your own account holds (where the agent's reimbursements land),
 * the way to pass it to pesos when there are any, and Salir.
 */
export function AccountPanel({ userName, account }: { userName: string; account: Address }) {
  const { balances, failed } = useAccountBalances(account, LOOK_EVERY_MS);
  return (
    <div className="grid gap-4">
      <p>Entraste como {userName}.</p>
      <div className="grid gap-1 rounded-[14px] bg-surface p-4">
        {balances === null ? (
          <p className="text-muted">{failed ? "No pudimos mirar tu cuenta. Probamos de nuevo en unos segundos." : "Mirando tu cuenta…"}</p>
        ) : (
          <>
            <p className="text-[24px] font-bold leading-tight [font-stretch:87%]">
              En tu cuenta tenés <span className="money">{formatPesos(balances.wars)}</span>
              {balances.usdt >= USDT_SPECK && (
                <>
                  {" "}
                  y <span className="money">{formatUsdt(balances.usdt)}</span>
                </>
              )}
            </p>
            <p className="text-sm text-muted">Acá llegan los reintegros del agente.</p>
          </>
        )}
      </div>
      {balances !== null &&
        (balances.wars >= WARS_SPECK ? (
          <PanelLink href="?p=pesos" className={buttonClass("primary")}>
            Pasar a pesos con Ripio
          </PanelLink>
        ) : (
          <p className="text-muted">Cuando el agente te devuelva un gasto, lo vas a ver acá.</p>
        ))}
      <LogoutButton />
    </div>
  );
}
