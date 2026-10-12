"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Address } from "viem";
import { isOnItsWay, userMessage } from "../lib/client/errors";
import { loadMe, sendCalls } from "../lib/client/wallet";
import { executeCalls } from "../lib/vote";
import { Button } from "./ui";

/**
 * Ejecutar, on a proposal that has its votes but didn't run with the last one (spec, 7.3: anyone may execute it).
 * One operation, confirmed with the passkey; the refreshed page then says "Se aprobó.".
 */
export function ExecuteButton({ fund, proposalId }: { fund: Address; proposalId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState("");
  // Once it's in, or out and may still land, it isn't offered again, whatever the page still shows.
  const [outcome, setOutcome] = useState<"open" | "done" | "on its way">("open");
  const busy = useRef(false); // a second click lands before the button re-renders as disabled

  async function execute() {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      setStep("signing");
      const me = await loadMe();
      await sendCalls(me, executeCalls({ fund, proposalId: BigInt(proposalId) }), { kind: "execute", fund }, () => setStep("sending"));
      setOutcome("done");
      router.refresh();
    } catch (caught) {
      setError(userMessage(caught));
      if (isOnItsWay(caught)) {
        setOutcome("on its way");
        router.refresh();
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
      <Button variant="secondary" className="py-2" disabled={step !== "idle" || outcome !== "open"} onClick={execute}>
        {step === "signing" ? "Confirmá con tu huella, tu cara o el PIN" : step === "sending" ? "Enviando…" : "Ejecutar"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-owe">
          {error}
        </p>
      )}
    </div>
  );
}
