"use client";

import { useRef, useState } from "react";
import type { Address } from "viem";
import { post } from "../lib/client/api";
import { isOnItsWay, userMessage } from "../lib/client/errors";
import { loadMe, sendCalls } from "../lib/client/wallet";
import { castVote } from "../lib/vote";
import { useRefresh } from "./refresh-provider";
import { Button } from "./ui";

/**
 * Votar, on an open proposal (spec, 9.2). A vote that completes the count also executes the proposal in the same
 * operation, so the money moves without anyone coming back to the app.
 */
export function VoteButton({ fund, proposalId, completes }: { fund: Address; proposalId: string; completes: boolean }) {
  const { refresh } = useRefresh();
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState("");
  // Once the vote is in, or is out and may still land, the button is not offered again, whatever the page still shows.
  const [outcome, setOutcome] = useState<"open" | "voted" | "on its way">("open");
  const busy = useRef(false); // a second click lands before the button re-renders as disabled

  async function vote() {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      setStep("signing");
      const me = await loadMe();
      await castVote(
        (calls) => {
          setStep("signing"); // each operation the vote takes asks for its own confirmation
          return sendCalls(me, calls, { kind: "vote", fund }, () => setStep("sending"));
        },
        { fund, proposalId: BigInt(proposalId), completes },
      );
      post("/api/agent/run").catch(() => {}); // the vote may have made something for the agent to do (spec, 8.3)
      setOutcome("voted");
      refresh();
    } catch (caught) {
      setError(userMessage(caught));
      if (isOnItsWay(caught)) {
        // It went out and may still land: the button stays off, and the page shows the vote "en camino" meanwhile.
        setOutcome("on its way");
        refresh();
      } else {
        busy.current = false;
      }
    } finally {
      setStep("idle");
    }
  }

  if (outcome === "voted") return <p className="mt-1 text-[13px] font-semibold text-muted">Votaste</p>;
  return (
    <div className="mt-2 grid justify-items-start gap-1">
      <Button variant="secondary" className="py-2" disabled={step !== "idle" || outcome !== "open"} onClick={vote}>
        {step === "signing" ? "Confirmá con tu huella, tu cara o el PIN" : step === "sending" ? "Enviando…" : "Votar"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-owe">
          {error}
        </p>
      )}
    </div>
  );
}
