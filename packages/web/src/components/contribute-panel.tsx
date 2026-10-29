"use client";

import { USDT, WARS } from "@tesoreria/agent";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type Address, erc20Abi } from "viem";
import { askAgentToRun } from "../lib/client/agent-run";
import { isOnItsWay, userMessage } from "../lib/client/errors";
import { celoBrowserClient, loadMe, sendCalls } from "../lib/client/wallet";
import {
  MIN_BINANCE_USDT,
  contributeCalls,
  defaultUsdtAmount,
  defaultWarsAmount,
  nextRate,
  pesosText,
  rampUrl,
  readPesosAmount,
  readUsdtAmount,
  roomUnderCap,
  usdtText,
  usdtToSend,
  usdtWorthText,
  weeklyContribution,
} from "../lib/contribute";
import { USDT_UNIT, formatPesos, formatUsdt } from "../lib/format";
import { DEFAULT_BALANCE_CAP, memberFundAbi } from "../lib/fund-abi";
import { useLocale, useMessages } from "../lib/i18n/client";
import { AddressBox } from "./address-box";
import { ContributeAmount } from "./contribute-amount";
import { useRefresh } from "./refresh-provider";
import { Button, ButtonLink } from "./ui";

type Token = "usdt" | "wars";
/**
 * What the member's account holds, and `rate`: what one USDT is worth to the fund (quoteUsdtInWars, the pool's
 * 30-minute average, the price it credits USDT at). A look that fails to read it keeps the last one (nextRate);
 * it is null only until a first one has been read.
 */
type Held = { usdt: bigint; wars: bigint; rate: bigint | null };

const WATCH_EVERY_MS = 10_000;

/**
 * Aportar (spec, 9, pantalla 3): where to send USDT (from Binance or any other exchange or wallet) or wARS (from
 * Ripio), and the button once the money has arrived.
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
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const { refresh } = useRefresh();
  const [tab, setTab] = useState<Token>("usdt");
  const [held, setHeld] = useState<Held | null>(null);
  const [lookFailed, setLookFailed] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [typedUsdt, setTypedUsdt] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState("");
  const [sentNow, setSentNow] = useState(false);
  const busy = useRef(false); // a second click lands before the button re-renders as disabled

  // Every 10 s, what has reached the member's account, and the fund's rate for USDT (spec, 9, pantalla 3).
  useEffect(() => {
    const client = celoBrowserClient();
    let live = true;
    const read = async () => {
      const [usdt, wars, rate] = await Promise.all([
        client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        client.readContract({ address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        client.readContract({ address: fund, abi: memberFundAbi, functionName: "quoteUsdtInWars", args: [USDT_UNIT] }).catch(() => null),
      ]);
      if (live) {
        setHeld((previous) => ({ usdt, wars, rate: nextRate(previous?.rate ?? null, rate) }));
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
  const cap = formatPesos(DEFAULT_BALANCE_CAP, locale);
  // This week's contribution, in pesos: what both tabs offer, and what the USDT one says how much to send for.
  const target = weeklyContribution({ owed, weeklyFee, room });
  // Reimbursements land in this same account, so wARS are offered by what the member owes, never by what they hold (F7).
  const warsDefault = defaultWarsAmount({ held: held?.wars ?? 0n, owed, weeklyFee, room });
  const warsReading = readPesosAmount(typed ?? pesosText(warsDefault, locale), { held: held?.wars ?? 0n, room }, m);
  // USDT too: what covers the week at the fund's rate, which moves, so the default follows it until the member types.
  const usdtOffer = { held: held?.usdt ?? 0n, rate: held?.rate ?? null, owed, weeklyFee, room };
  const usdtDefault = defaultUsdtAmount(usdtOffer);
  const usdtReading = typedUsdt === null ? ({ ok: true, amount: usdtDefault } as const) : readUsdtAmount(typedUsdt, usdtOffer, m);
  const toSend = held === null ? null : usdtToSend(usdtOffer);
  const reading = tab === "usdt" ? usdtReading : warsReading;
  const amount = reading.ok ? reading.amount : 0n;
  const label = tab === "usdt" ? formatUsdt(amount, locale) : formatPesos(amount, locale);
  const holding = held === null ? 0n : held[tab];
  // Whether the server knows of one (a reopened panel, another tab) or this click just sent one: either way, no second.
  const onItsWay = contributionOnItsWay || sentNow;
  // What the USDT tab says over the address: how much to send ("more" once some USDT is already held), and Binance's minimum.
  const sendAtLeast = held !== null && held.usdt > 0n ? m.contribute.sendAtLeastMore : m.contribute.sendAtLeast;
  const binanceMinimum = toSend !== null && toSend > 0n && toSend < MIN_BINANCE_USDT ? m.contribute.binanceMinimumLeftover : m.contribute.binanceMinimum;

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
      void askAgentToRun(); // convert now rather than at the next heartbeat, in either token (spec, 8.3)
      router.replace(`/f/${fund}?aporte=${balance}`, { scroll: false });
      refresh();
    } catch (caught) {
      setError(userMessage(caught, m));
      setStep("idle");
      if (isOnItsWay(caught)) {
        // It went out and may still land: the button stays off, and the page shows it "en camino" meanwhile.
        setSentNow(true);
        refresh();
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
            {token === "usdt" ? m.contribute.haveUsdt : m.contribute.havePesos}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="grid gap-4">
        {tab === "usdt" ? (
          <p>
            {toSend !== null && toSend > 0n
              ? sendAtLeast(<span className="money font-semibold">{formatUsdt(toSend, locale)}</span>, <span className="money">{formatPesos(target, locale)}</span>)
              : m.contribute.sendUsdt}{" "}
            {binanceMinimum(<span className="money">{formatUsdt(MIN_BINANCE_USDT, locale)}</span>)}
          </p>
        ) : (
          <div className="grid gap-2">
            <p>{m.contribute.ripioWithdraw}</p>
            <ButtonLink
              href={rampUrl(account, target)}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
            >
              {m.contribute.loadWithRipio}
            </ButtonLink>
          </div>
        )}

        <AddressBox address={account} />

        {/* 8 px around the amount's own box (spec, 9.7); a sentence alone keeps 16 px, as the panel's other boxes. */}
        <div className="grid gap-2 rounded-[14px] bg-surface p-2">
          {onItsWay ? (
            !sentNow && <p className="p-2 font-semibold">{m.contribute.onItsWay}</p>
          ) : held === null ? (
            <p className="p-2 text-muted">{lookFailed ? m.account.readFailed : m.account.reading}</p>
          ) : holding === 0n ? (
            <p className="p-2 text-muted">{m.contribute.nothingYet}</p>
          ) : room === 0n || (tab === "usdt" && usdtDefault === 0n) ? (
            <p className="p-2 font-semibold text-owe">{m.contribute.capReachedNotice(<span className="money">{cap}</span>)}</p>
          ) : (
            <>
              <ContributeAmount
                label={m.contribute.amountLabel}
                held={m.contribute.youHold(
                  <span className="money font-semibold">{tab === "usdt" ? formatUsdt(held.usdt, locale) : formatPesos(held.wars, locale)}</span>,
                )}
                token={tab}
                value={tab === "usdt" ? (typedUsdt ?? usdtText(usdtDefault, locale)) : (typed ?? pesosText(warsDefault, locale))}
                problem={reading.ok ? "" : reading.error}
                note={tab === "usdt" && usdtReading.ok && held.rate !== null ? usdtWorthText(usdtReading.amount, held.rate, target, m) : undefined}
                disabled={step !== "idle"}
                onChange={tab === "usdt" ? setTypedUsdt : setTyped}
              />
              <Button disabled={step !== "idle" || amount === 0n} onClick={contribute}>
                {step === "signing" ? m.common.confirm : step === "sending" ? m.common.sending : m.contribute.submit(label)}
              </Button>
            </>
          )}
          <p role="alert" className="px-2 text-sm text-owe">
            {error}
          </p>
        </div>
      </div>
    </div>
  );
}
