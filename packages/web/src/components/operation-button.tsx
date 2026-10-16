"use client";

import type { Call } from "@tesoreria/wallet";
import { useRef, useState } from "react";
import { isOnItsWay, userMessage } from "../lib/client/errors";
import { type OperationInfo, loadMe, sendCalls } from "../lib/client/wallet";
import { useMessages } from "../lib/i18n/client";
import { useRefresh } from "./refresh-provider";
import { Button } from "./ui";

/**
 * A button on a movement that sends one operation, confirmed with the passkey: the body Ejecutar and Proponer sumarlo
 * share (execute-button.tsx, propose-member-button.tsx). `calls` is built when the person taps, not before. The
 * refreshed page then tells what happened, so once it's in the button is gone; and once it's out and may still land, it
 * isn't offered again, whatever the page still shows.
 */
export function OperationButton({ calls, operation, label }: { calls: () => Call[]; operation: OperationInfo; label: string }) {
  const m = useMessages();
  const { refresh } = useRefresh();
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"open" | "done" | "on its way">("open");
  const busy = useRef(false); // a second click lands before the button re-renders as disabled

  async function send() {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      setStep("signing");
      const me = await loadMe();
      await sendCalls(me, calls(), operation, () => setStep("sending"));
      setOutcome("done");
      refresh();
    } catch (caught) {
      setError(userMessage(caught, m));
      if (isOnItsWay(caught)) {
        setOutcome("on its way");
        refresh();
      } else {
        busy.current = false;
      }
    } finally {
      setStep("idle");
    }
  }

  if (outcome === "done") return null;
  return (
    <div className="mt-2 grid justify-items-start gap-1">
      <Button variant="secondary" className="py-2" disabled={step !== "idle" || outcome !== "open"} onClick={send}>
        {step === "signing" ? m.common.confirm : step === "sending" ? m.common.sending : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-owe">
          {error}
        </p>
      )}
    </div>
  );
}
