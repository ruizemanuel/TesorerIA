"use client";

import { type FundVersion, fundV2Abi } from "@tesoreria/agent";
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
  nextRate,
  rampUrl,
  readUsdtAmount,
  roomUnderCap,
  usdtText,
  usdtToSend,
  usdtWorthText,
  warsField,
  weeklyContribution,
  withFee,
} from "../lib/contribute";
import { USDT_UNIT, formatPercent, formatPesos, formatUsdt, upToCentavo } from "../lib/format";
import { memberFundAbi } from "../lib/fund-abi";
import { useLocale, useMessages } from "../lib/i18n/client";
import { AddressBox } from "./address-box";
import { ContributeAmount } from "./contribute-amount";
import { useRefresh } from "./refresh-provider";
import { Button, ButtonLink } from "./ui";

type Token = "usdt" | "wars";
/**
 * What the member's account holds of the fund's dollar (`usdt`) and currency (`wars`), and `rate`: what one USDT is
 * worth to the fund, the pool's 30-minute average, the price it values USDT at (version 1's quoteUsdtInWars, version 2's
 * quoteDollar). A look that fails to read it keeps the last one (nextRate); it is null only until a first one has been
 * read, and for good in a fund with no dollar.
 */
type Held = { usdt: bigint; wars: bigint; rate: bigint | null };

const WATCH_EVERY_MS = 10_000;

/**
 * Aportar (spec, 9, pantalla 3): where to send USDT (from Binance or any other exchange or wallet) or wARS (from
 * Ripio), and the button once the money has arrived.
 * `balance` is the fund's, as the page showed it: the one the balance counts up from afterwards (spec, 9.2).
 * `version`, `currency`, `dollar`, `feeBps`, `counted` and `balanceCap` are the fund's (FundView): a version 2 fund
 * asks what credits the week whole after its fee, and says the fee it includes.
 */
export function ContributePanel({
  fund,
  version,
  account,
  currency,
  dollar,
  feeBps,
  balance,
  counted,
  balanceCap,
  owed,
  weeklyFee,
  contributionOnItsWay,
}: {
  fund: Address;
  version: FundVersion;
  account: Address;
  currency: Address;
  dollar: Address | null;
  feeBps: number;
  balance: bigint;
  /** What the contract counts toward `balanceCap` (FundView). */
  counted: bigint;
  balanceCap: bigint;
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
  // A fund with no dollar takes its currency alone.
  const tokens: readonly Token[] = dollar === null ? ["wars"] : ["usdt", "wars"];
  const [tab, setTab] = useState<Token>(dollar === null ? "wars" : "usdt");
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
    const rate = () =>
      version === 2
        ? client.readContract({ address: fund, abi: fundV2Abi, functionName: "quoteDollar", args: [USDT_UNIT] })
        : client.readContract({ address: fund, abi: memberFundAbi, functionName: "quoteUsdtInWars", args: [USDT_UNIT] });
    const read = async () => {
      const [usdt, wars, rateNow] = await Promise.all([
        dollar === null ? 0n : client.readContract({ address: dollar, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        client.readContract({ address: currency, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        dollar === null ? null : rate().catch(() => null),
      ]);
      if (live) {
        setHeld((previous) => ({ usdt, wars, rate: nextRate(previous?.rate ?? null, rateNow) }));
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
  }, [account, fund, version, currency, dollar]);

  // What still fits under the cap: in pesos, what goes in before the fee (roomUnderCap); in USDT, their value at the
  // fund's rate, with no fee, since a version 2 fund counts pending dollars whole. In version 1, both what is left.
  const room = roomUnderCap(counted, balanceCap, feeBps);
  const usdtRoom = roomUnderCap(counted, balanceCap, 0);
  const cap = formatPesos(balanceCap, locale);
  // This week's contribution, in pesos, net of any fee: what both tabs cover, and what the USDT one says how much to send for.
  const target = weeklyContribution({ owed, weeklyFee, room: usdtRoom });
  // Reimbursements land in this same account, so wARS are offered by what the member owes, never by what they hold (F7).
  // In a version 2 fund, what credits the week whole after the fee.
  const wars = warsField(typed, { held: held?.wars ?? 0n, owed, weeklyFee, room, feeBps }, version, balanceCap, m);
  // USDT too: what covers the week at the fund's rate, which moves, so the default follows it until the member types.
  const usdtOffer = { held: held?.usdt ?? 0n, rate: held?.rate ?? null, owed, weeklyFee, room: usdtRoom, feeBps };
  const usdtDefault = defaultUsdtAmount(usdtOffer);
  const usdtReading = typedUsdt === null ? ({ ok: true, amount: usdtDefault } as const) : readUsdtAmount(typedUsdt, { ...usdtOffer, cap: balanceCap }, m);
  const toSend = held === null ? null : usdtToSend(usdtOffer);
  const reading = tab === "usdt" ? usdtReading : wars.reading;
  const amount = reading.ok ? reading.amount : 0n;
  // Pesos up to the centavo, as the field shows them: what was typed already is, and a version 2 fee's amount is a fraction over.
  const label = tab === "usdt" ? formatUsdt(amount, locale) : formatPesos(upToCentavo(amount), locale);
  // Ripio loads what the pesos tab asks: in a version 2 fund, what credits the week after the fee, up to the centavo.
  const rampAmount = version === 2 ? upToCentavo(withFee(target, feeBps)) : target;
  // Under the amount: in USDT, what it covers at the fund's rate; in either tab, the fee a version 2 fund leaves of it.
  const usdtNote = held !== null && held.rate !== null && usdtReading.ok ? usdtWorthText(usdtReading.amount, held.rate, target, m) : null;
  const feeNote = feeBps > 0 ? m.contribute.feeNote(formatPercent(feeBps, locale)) : null;
  const notes = [tab === "usdt" ? usdtNote : null, feeNote].filter((part) => part !== null);
  const note = notes.length > 0 ? notes.join(" ") : undefined;
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
      await sendCalls(me, contributeCalls({ fund, version, token: tab, amount, currency, dollar }), { kind: "contribute", fund, amount, token: tab }, () =>
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
      <div className={`grid ${tokens.length === 2 ? "grid-cols-2" : "grid-cols-1"} gap-1 rounded-[14px] bg-tint p-1`} role="tablist">
        {tokens.map((token) => (
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
              href={rampUrl(account, rampAmount)}
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
                value={tab === "usdt" ? (typedUsdt ?? usdtText(usdtDefault, locale)) : wars.value}
                problem={reading.ok ? "" : reading.error}
                note={note}
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
