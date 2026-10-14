"use client";

import { useEffect, useRef, useState } from "react";
import { type Address, getAddress } from "viem";
import { ACCOUNT_CHANGED } from "../lib/account-reader";
import { browserStorage, cashOutCalls, cashOutProblem, readCashOutAmount, rememberRipioAddress, rememberedRipioAddress } from "../lib/cash-out";
import { useAccountBalances } from "../lib/client/account";
import { isOnItsWay, userMessage } from "../lib/client/errors";
import { loadMe, sendCalls } from "../lib/client/wallet";
import { pesosText } from "../lib/contribute";
import { WARS_SPECK, formatPesos } from "../lib/format";
import { NetworkWarning } from "./address-box";
import { AmountField } from "./amount-field";
import { useRefresh } from "./refresh-provider";
import { Button, FIELD } from "./ui";

const LOOK_EVERY_MS = 10_000;
const ADDRESS = "narrow break-all rounded-[14px] bg-surface p-3 text-center text-[15px] font-semibold [font-variant-numeric:lining-nums_tabular-nums]";

/**
 * Pasar a pesos (spec, 9, pantalla 8, and 9.2): the member's wARS, sent from their own account to their Ripio
 * deposit address on Celo, where Ripio's app sells them 1:1 for pesos. The address is remembered by this browser
 * only, after a pass that went well. The amount is all the account holds until the member types another; after a
 * pass, nothing is offered until a read made after it (useAccountBalances says when, and waits for the pass's
 * block), so the old balance is never offered again.
 */
export function CashOutPanel({ fund, account, cashOutOnItsWay }: { fund: Address; account: Address; cashOutOnItsWay: boolean }) {
  const { refresh } = useRefresh();
  // `stale`: right after a pass, until the account is read again, the balances are the old ones.
  const { balances, failed, changing: stale } = useAccountBalances(account, LOOK_EVERY_MS);
  // Undefined until this browser was asked, after the first render: the server can't know it.
  const [saved, setSaved] = useState<Address | null | undefined>(undefined);
  const [changing, setChanging] = useState(false);
  const [pasted, setPasted] = useState("");
  const [typed, setTyped] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState("");
  const [passed, setPassed] = useState<bigint | null>(null);
  const [sentNow, setSentNow] = useState(false);
  const busy = useRef(false); // a second click lands before the button re-renders as disabled

  useEffect(() => setSaved(rememberedRipioAddress(browserStorage(), account)), [account]);

  const asking = saved === null || changing;
  const destination = asking ? pasted.trim() : (saved ?? "");
  const addressProblem = destination === "" ? null : cashOutProblem(destination, { account, fund });
  const fresh = balances !== null && !stale ? balances : null;
  const reading = fresh === null ? null : readCashOutAmount(typed, fresh.wars);
  const onItsWay = cashOutOnItsWay || sentNow;
  const amount = reading?.ok ? reading.amount : null;
  const ready = step === "idle" && !onItsWay && amount !== null && destination !== "" && addressProblem === null;

  async function cashOut() {
    if (busy.current || !ready || amount === null) return;
    busy.current = true;
    setError("");
    try {
      setStep("signing");
      const me = await loadMe();
      const to = getAddress(destination);
      const result = await sendCalls(me, cashOutCalls({ to, amount }), { kind: "cash-out", amount, token: "wars" }, () => setStep("sending"));
      rememberRipioAddress(browserStorage(), account, to);
      setSaved(to);
      setChanging(false);
      setPasted("");
      setTyped(null);
      setPassed(amount);
      // The panel and the inicio's line read the account again, once the node has the pass's block. The hook marks
      // the balances as old in the same batch that ends this step, so no render offers them again.
      window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED, { detail: result.blockNumber ?? undefined }));
      setStep("idle");
      busy.current = false;
    } catch (caught) {
      setError(userMessage(caught));
      setStep("idle");
      if (isOnItsWay(caught)) {
        setSentNow(true); // it went out and may still land: no second one
        refresh();
      } else {
        busy.current = false;
      }
    }
  }

  return (
    <div className="grid gap-4">
      {passed !== null && (
        <p role="status" className="rounded-[14px] bg-surface p-4 font-semibold">
          Pasaste <span className="money">{formatPesos(passed)}</span> a Ripio. En un minuto lo ves en la app: ahí lo vendés 1:1 a pesos y lo
          pasás a tu banco.
        </p>
      )}

      {saved === undefined ? null : asking ? (
        <div className="grid gap-3">
          <p>En la app de Ripio tocá Depositar, elegí wARS y la red Celo, y copiá la dirección.</p>
          <NetworkWarning />
          <label className="grid gap-1">
            <span className="font-semibold">Tu dirección de Ripio</span>
            <input
              className={`${FIELD} narrow`}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={pasted}
              disabled={step !== "idle"}
              aria-invalid={addressProblem !== null}
              aria-describedby="address-problem"
              onChange={(event) => setPasted(event.target.value)}
            />
          </label>
          <p id="address-problem" role="alert" className="min-h-5 text-sm text-owe">
            {addressProblem ?? ""}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          <p>A tu cuenta de Ripio</p>
          <p className={ADDRESS}>{saved}</p>
          {addressProblem !== null && (
            <p role="alert" className="text-sm text-owe">
              {addressProblem}
            </p>
          )}
          <Button variant="link" disabled={step !== "idle"} onClick={() => setChanging(true)}>
            Cambiar
          </Button>
        </div>
      )}

      <div className="grid gap-3 rounded-[14px] bg-surface p-4">
        {onItsWay ? (
          !sentNow && <p className="font-semibold">Tu pase a pesos está en camino.</p>
        ) : fresh === null ? (
          <p className="text-muted">{failed ? "No pudimos mirar tu cuenta. Probamos de nuevo en unos segundos." : "Mirando tu cuenta…"}</p>
        ) : fresh.wars < WARS_SPECK ? (
          <p className="text-muted">No tenés pesos en tu cuenta para pasar.</p>
        ) : (
          <>
            <p>
              Tenés <span className="money font-semibold">{formatPesos(fresh.wars)}</span> en tu cuenta.
            </p>
            <AmountField
              label="Cuánto pasás"
              value={typed ?? pesosText(fresh.wars)}
              problem={reading?.ok === false ? reading.error : ""}
              disabled={step !== "idle"}
              onChange={setTyped}
            />
            <Button disabled={!ready} onClick={cashOut}>
              {step === "signing"
                ? "Confirmá con tu huella, tu cara o el PIN"
                : step === "sending"
                  ? "Enviando…"
                  : amount === null
                    ? "Pasar a Ripio"
                    : `Pasar ${formatPesos(amount)} a Ripio`}
            </Button>
          </>
        )}
        <p role="alert" className="text-sm text-owe">
          {error}
        </p>
      </div>
    </div>
  );
}
