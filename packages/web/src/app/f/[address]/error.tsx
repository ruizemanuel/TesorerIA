"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../components/ui";
import { useMessages } from "../../../lib/i18n/client";
import { nextRetryDelay } from "../../../lib/retry";

/** When this page asked the server again by itself. Kept by the module: each try that fails mounts the page anew. */
const tries: number[] = [];

/**
 * What went wrong and what to do (spec, 9.2): the chain or its history couldn't be read just now. That is often a
 * matter of seconds (a node behind, Blockscout busy), so the page asks the server for itself again a few times,
 * each time later (nextRetryDelay), and then leaves it to the person. `retry` asks the server again; `reset` would
 * only redraw the error it already has.
 */
export default function FundError({ retry }: { retry: () => void }) {
  const m = useMessages();
  const [delay] = useState(() => nextRetryDelay(tries, Date.now()));
  useEffect(() => {
    if (delay === null) return;
    const timer = setTimeout(() => {
      tries.push(Date.now());
      retry();
    }, delay);
    return () => clearTimeout(timer);
  }, [delay, retry]);

  return (
    <main className="mx-auto grid max-w-[560px] gap-3 p-4 pt-10">
      <p className="text-lg font-bold">{m.fundError.title}</p>
      <p className="text-muted">
        {m.fundError.moneyIsFine} {delay === null ? m.fundError.tryLater : m.fundError.retrying}
      </p>
      <Button onClick={retry}>{m.fundError.retry}</Button>
    </main>
  );
}
