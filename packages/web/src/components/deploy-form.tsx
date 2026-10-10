"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { del, post } from "../lib/client/api";
import { userMessage } from "../lib/client/errors";
import { loadMe, sendCalls, settleOperation } from "../lib/client/wallet";
import type { DeployStep } from "../lib/funds";
import { Button } from "./ui";

/**
 * The creator picks the votes and creates the fund in Celo, signing with their passkey (spec, 9).
 * `chosenVotes`: the ones of a creation already started, which stay as they are until it ends.
 */
export function DeployForm({ fundId, memberCount, chosenVotes }: { fundId: string; memberCount: number; chosenVotes: number | null }) {
  const router = useRouter();
  const [votes, setVotes] = useState(chosenVotes ?? Math.max(2, Math.ceil(memberCount / 2)));
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState("");
  const options = Array.from({ length: memberCount - 2 }, (_, i) => i + 2);

  /** The fund if it's already in Celo, or the call to sign. A createFund that went out is never sent again (spec, 6). */
  async function nextStep(): Promise<Exclude<DeployStep, { pending: unknown }>> {
    const ask = () => post<DeployStep>(`/api/drafts/${fundId}/deploy`, { votesRequired: votes });
    let next = await ask();
    while ("pending" in next) {
      // One went out and the server never got its receipt: the bundler's answer comes before anything else.
      setStep("sending");
      await settleOperation(next.pending); // "en camino" while it isn't included
      next = await ask();
    }
    return next;
  }

  /** Signs and sends the call; the fund's address once it's in Celo. */
  async function create(call: Extract<DeployStep, { call: unknown }>["call"]): Promise<string> {
    const me = await loadMe();
    const result = await sendCalls(me, [call], { kind: "create-fund", draftId: fundId }, () => setStep("sending"));
    const { address } = await post<{ address: string }>(`/api/drafts/${fundId}/deployed`, { transactionHash: result.transactionHash });
    return address;
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="font-semibold">Votos necesarios para lo que no es el gasto acordado</span>
        <select
          className="min-h-12 rounded-[14px] border border-line bg-surface px-3"
          value={votes}
          onChange={(event) => setVotes(Number(event.target.value))}
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {n} de {memberCount}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={step !== "idle"}
        onClick={async () => {
          setError("");
          setStep("signing");
          let built = false;
          try {
            const next = await nextStep();
            if ("address" in next) {
              router.push(`/f/${next.address}`);
            } else {
              built = true;
              router.push(`/f/${await create(next.call)}`);
            }
          } catch (caught) {
            // Only a deploy this click built is called off, so people can join again: a refusal from the server,
            // say while another tab is signing, leaves the draft as it is. The server also keeps the list frozen
            // while a createFund is on its way.
            if (built) await del(`/api/drafts/${fundId}/deploy`).catch(() => {});
            setError(userMessage(caught));
            setStep("idle");
          }
        }}
      >
        {step === "signing" ? "Confirmá con tu huella, tu cara o el PIN" : step === "sending" ? "Creando el fondo…" : "Crear el fondo"}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </div>
  );
}
