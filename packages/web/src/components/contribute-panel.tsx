"use client";

import { USDT, WARS } from "@tesoreria/agent";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type Address, erc20Abi } from "viem";
import { post } from "../lib/client/api";
import { isOnItsWay, userMessage } from "../lib/client/errors";
import { celoBrowserClient, loadMe, sendCalls } from "../lib/client/wallet";
import {
  MIN_BINANCE_USDT,
  contributeCalls,
  defaultWarsAmount,
  fitUnderCap,
  pesosText,
  rampUrl,
  readPesosAmount,
  roomUnderCap,
  weeklyContribution,
} from "../lib/contribute";
import { formatPesos, formatUsdt } from "../lib/format";
import { DEFAULT_BALANCE_CAP, memberFundAbi } from "../lib/fund-abi";
import { AddressBox } from "./address-box";
import { Button, ButtonLink, FIELD } from "./ui";

type Token = "usdt" | "wars";
/** What the member's account holds. `usdtInWars` is what all that USDT is worth at the fund's rate; null if it couldn't be read. */
type Held = { usdt: bigint; wars: bigint; usdtInWars: bigint | null };

const WATCH_EVERY_MS = 10_000;

/**
 * Aportar (spec, 9, pantalla 3): where to send from Binance or Ripio, and the button once the money has arrived.
 * `balance` is the fund's, as the page showed it: the one the balance counts up from afterwards (spec, 9.2).
 */
export function ContributePanel({
  fund,
  account,
  balance,
  owed,
  weeklyFee,
  contributionOnItsWay,
}: {
  fund: Address;
  account: Address;
  balance: bigint;
  /** What this member still owes through this week. */
  owed: bigint;
  weeklyFee: bigint;
  /** A contribution of this member's already went out and has no receipt yet: the button is not offered again. */
  contributionOnItsWay: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Token>("usdt");
  const [held, setHeld] = useState<Held | null>(null);
  const [lookFailed, setLookFailed] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState("");
  const [sentNow, setSentNow] = useState(false);
  const busy = useRef(false); // a second click lands before the button re-renders as disabled

  // Every 10 s, what has reached the member's account (spec, 9, pantalla 3).
  useEffect(() => {
    const client = celoBrowserClient();
    let live = true;
    const read = async () => {
      const [usdt, wars] = await Promise.all([
        client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        client.readContract({ address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      ]);
      const usdtInWars =
        usdt === 0n
          ? 0n
          : await client.readContract({ address: fund, abi: memberFundAbi, functionName: "quoteUsdtInWars", args: [usdt] }).catch(() => null);
      if (live) {
        setHeld({ usdt, wars, usdtInWars });
        setLookFailed(false);
      }
    };
    const look = () =>
      read().catch(() => {
        if (live) setLookFailed(true);
      });
    look();
    const timer = setInterval(look, WATCH_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [account, fund]);

  const room = roomUnderCap(balance);
  const cap = formatPesos(DEFAULT_BALANCE_CAP);
  // Reimbursements land in this same account, so wARS are offered by what the member owes, never by what they hold (F7).
  const warsDefault = defaultWarsAmount({ held: held?.wars ?? 0n, owed, weeklyFee, room });
  const warsReading = readPesosAmount(typed ?? pesosText(warsDefault), { held: held?.wars ?? 0n, room });
  const usdtOffer = held === null ? 0n : fitUnderCap(held.usdt, held.usdtInWars, room);
  const amount = tab === "usdt" ? usdtOffer : warsReading.ok ? warsReading.amount : 0n;
  const label = tab === "usdt" ? formatUsdt(amount) : formatPesos(amount);
  const holding = held === null ? 0n : held[tab];
  // Whether the server knows of one (a reopened panel, another tab) or this click just sent one: either way, no second.
  const onItsWay = contributionOnItsWay || sentNow;

  async function contribute() {
    if (busy.current || amount === 0n) return;
    busy.current = true;
    setError("");
    try {
      setStep("signing");
      const me = await loadMe();
      await sendCalls(me, contributeCalls({ fund, token: tab, amount }), { kind: "contribute", fund, amount, token: tab }, () =>
        setStep("sending"),
      );
      post("/api/agent/run").catch(() => {}); // convert now rather than at the next heartbeat, in either token (spec, 8.3)
      router.replace(`/f/${fund}?aporte=${balance}`, { scroll: false });
      router.refresh();
    } catch (caught) {
      setError(userMessage(caught));
      setStep("idle");
      if (isOnItsWay(caught)) {
        // It went out and may still land: the button stays off, and the page shows it "en camino" meanwhile.
        setSentNow(true);
        router.refresh();
      } else {
        busy.current = false;
      }
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-tint p-1" role="tablist">
        {(["usdt", "wars"] as const).map((token) => (
          <button
            key={token}
            type="button"
            role="tab"
            aria-selected={tab === token}
            disabled={step !== "idle"}
            onClick={() => setTab(token)}
            className={`min-h-11 rounded-[11px] text-sm font-bold ${tab === token ? "bg-surface text-primary" : "text-muted"}`}
          >
            {token === "usdt" ? "Tengo USDT en Binance" : "Tengo pesos en Ripio"}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="grid gap-4">
        {tab === "usdt" ? (
          <p>
            En Binance, retirá USDT a tu cuenta del fondo. El mínimo de Binance es <span className="money">{formatUsdt(MIN_BINANCE_USDT)}</span>.
          </p>
        ) : (
          <div className="grid gap-2">
            <p>En la app de Ripio, retirá wARS por la red Celo a tu cuenta del fondo. O cargalos directo:</p>
            <ButtonLink
              href={rampUrl(account, weeklyContribution({ owed, weeklyFee, room }))}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
            >
              Cargar pesos con Ripio
            </ButtonLink>
          </div>
        )}

        <AddressBox address={account} />

        <div className="grid gap-3 rounded-[14px] bg-surface p-4">
          {onItsWay ? (
            !sentNow && <p className="font-semibold">Tu aporte está en camino. Cuando se confirme, lo ves en el fondo.</p>
          ) : held === null ? (
            <p className="text-muted">{lookFailed ? "No pudimos mirar tu cuenta. Probamos de nuevo en unos segundos." : "Mirando tu cuenta…"}</p>
          ) : holding === 0n ? (
            <p className="text-muted">Todavía no llegó nada. Cuando llegue, aparece acá; puede tardar unos minutos.</p>
          ) : room === 0n || (tab === "usdt" && usdtOffer === 0n) ? (
            <p className="font-semibold text-owe">
              El fondo llegó a su tope de <span className="money">{cap}</span>: no entra más.
            </p>
          ) : (
            <>
              <p>
                Tenés <span className="money font-semibold">{tab === "usdt" ? formatUsdt(held.usdt) : formatPesos(held.wars)}</span> en tu cuenta.
              </p>
              {tab === "usdt" && usdtOffer < held.usdt && (
                <p className="text-sm text-muted">
                  El fondo tiene un tope de <span className="money">{cap}</span>, así que ahora le entran <span className="money">{formatUsdt(usdtOffer)}</span>.
                </p>
              )}
              {tab === "wars" && (
                <div className="grid gap-1">
                  <label className="grid gap-1">
                    <span className="font-semibold">Cuánto aportás</span>
                    <input
                      className={`${FIELD} money`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={typed ?? pesosText(warsDefault)}
                      disabled={step !== "idle"}
                      aria-invalid={!warsReading.ok}
                      aria-describedby="amount-problem"
                      onChange={(event) => setTyped(event.target.value)}
                    />
                  </label>
                  <p id="amount-problem" role="alert" className="min-h-5 text-sm text-owe">
                    {warsReading.ok ? "" : warsReading.error}
                  </p>
                </div>
              )}
              <Button disabled={step !== "idle" || amount === 0n} onClick={contribute}>
                {step === "signing" ? "Confirmá con tu huella, tu cara o el PIN" : step === "sending" ? "Enviando…" : `Aportar ${label}`}
              </Button>
            </>
          )}
          <p role="alert" className="text-sm text-owe">
            {error}
          </p>
        </div>
      </div>
    </div>
  );
}
