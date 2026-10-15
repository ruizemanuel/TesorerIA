"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { del, post } from "../lib/client/api";
import { isOnItsWay, userMessage } from "../lib/client/errors";
import { loadMe, sendCalls, settleOperation } from "../lib/client/wallet";
import type { DeployStep } from "../lib/funds";
import { useMessages } from "../lib/i18n/client";
import { Button } from "./ui";

type Call = Extract<DeployStep, { call: unknown }>["call"];
/** The deploy route's answer: a DeployStep whose pinned nonce comes as a decimal string (JSON has no bigint). */
type Answer = Exclude<DeployStep, { call: unknown }> | { call: Call; nonce?: string };

/**
 * The creator picks the votes and creates the fund in Celo, signing with their passkey (spec, 9).
 * `chosenVotes`: the ones of a creation already started, which stay as they are until it ends.
 */
export function DeployForm({ fundId, memberCount, chosenVotes }: { fundId: string; memberCount: number; chosenVotes: number | null }) {
  const m = useMessages();
  const router = useRouter();
  const [votes, setVotes] = useState(chosenVotes ?? Math.max(2, Math.ceil(memberCount / 2)));
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState("");
  const options = Array.from({ length: memberCount - 2 }, (_, i) => i + 2);

  /** The fund if it's already in Celo, or the call to sign. A createFund that went out is never sent again (spec, 6). */
  async function nextStep(): Promise<Exclude<Answer, { pending: unknown }>> {
    const ask = () => post<Answer>(`/api/drafts/${fundId}/deploy`, { votesRequired: votes });
    let next = await ask();
    while ("pending" in next) {
      // One went out and the server never got its receipt: the bundler's answer comes before anything else.
      setStep("sending");
      await settleOperation(next.pending); // "en camino" while it isn't included
      next = await ask();
    }
    return next;
  }

  /** Signs and sends the call, pinned to `nonce` when it resends one that never came back; the fund's address. */
  async function create(call: Call, nonce: string | undefined): Promise<string> {
    const me = await loadMe();
    const info = { kind: "create-fund", draftId: fundId } as const;
    const result = await sendCalls(me, [call], info, () => setStep("sending"), nonce === undefined ? undefined : BigInt(nonce));
    const { address } = await post<{ address: string }>(`/api/drafts/${fundId}/deployed`, { transactionHash: result.transactionHash });
    return address;
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="font-semibold">{m.deploy.votesNeeded}</span>
        <select
          className="min-h-12 rounded-[14px] border border-field-line bg-surface px-3"
          value={votes}
          onChange={(event) => setVotes(Number(event.target.value))}
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {m.deploy.votesOption(n, memberCount)}
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
              router.push(`/f/${await create(next.call, next.nonce)}`);
            }
          } catch (caught) {
            // Only a deploy this click built is called off, so people can join again: a refusal from the server,
            // say while another tab is signing, leaves the draft as it is. Nor is one that went out and may still
            // land: reopening the draft would let the list change under a createFund that is about to be created.
            // The server also keeps the list frozen while a createFund is on its way.
            if (built && !isOnItsWay(caught)) await del(`/api/drafts/${fundId}/deploy`).catch(() => {});
            setError(userMessage(caught, m));
            setStep("idle");
          }
        }}
      >
        {step === "signing" ? m.common.confirm : step === "sending" ? m.deploy.creating : m.deploy.submit}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </div>
  );
}
