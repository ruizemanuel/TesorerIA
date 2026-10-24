"use client";

import { useEffect, useId, useRef, useState } from "react";
import { userMessage } from "../lib/client/errors";
import { type KeyChangeStep, changeKey, confirmOnLoad } from "../lib/client/key-change";
import { loadMe } from "../lib/client/wallet";
import { useMessages } from "../lib/i18n/client";
import type { Messages } from "../lib/i18n/messages";
import { useRefresh } from "./refresh-provider";
import { Button, Card, CardTitle } from "./ui";

/**
 * What a page asks of a member about their passkey (spec, 9.5). `due`: the request is shown. `resume`: a new passkey
 * is pending already, so the request is to finish the change, not to start it.
 */
export type KeyChangeAsk = { due: boolean; resume: boolean };

/** Where the browser keeps that the person said "Ahora no": until its session ends. */
const LATER_KEY = "tesoreria.key-change-later";

/** Whether the person said "Ahora no" in this session. Storage that fails (a private window, blocked site data) reads as no. */
function saidLater(): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === "yes";
  } catch {
    return false;
  }
}

function sayLater(): void {
  try {
    sessionStorage.setItem(LATER_KEY, "yes");
  } catch {
    // Not remembering only means being asked again on the next page.
  }
}

type Outcome = "open" | "changed" | "waiting";

/** What to tell the person: the step that is running (`starting` is before the first), or else how the change ended. */
function statusText(m: Messages, step: KeyChangeStep | "starting" | null, outcome: Outcome): string {
  if (step === "starting") return m.keyChange.working;
  if (step !== null) return m.keyChange.step[step];
  if (outcome === "changed") return m.keyChange.done;
  return outcome === "waiting" ? m.keyChange.waiting : "";
}

/**
 * The key change a button runs (spec, 9.5): `changeKey` from where `/api/me` says the person is when they tap, and
 * what to tell them meanwhile. A change that completes refreshes the page, which stops asking.
 *
 * With `resume`, the page found a passkey pending, so it asks the chain once as it loads (`confirmOnLoad`): a swap
 * that landed after its page closed is confirmed then, as if the person had tapped, and a failure says nothing.
 */
function useKeyChange(resume = false) {
  const m = useMessages();
  const { refresh } = useRefresh();
  const [step, setStep] = useState<KeyChangeStep | "starting" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("open"); // changed or waiting: the button is not offered again
  const [error, setError] = useState("");
  const busy = useRef(false); // a second click lands before the button re-renders as disabled
  const asked = useRef(false); // once per page, even when React runs the effect twice

  useEffect(() => {
    if (!resume || asked.current) return;
    asked.current = true;
    void confirmOnLoad(resume).then((changed) => {
      if (!changed) return;
      setOutcome("changed");
      refresh();
    });
  }, [resume, refresh]);

  async function change() {
    if (busy.current) return;
    busy.current = true;
    setError("");
    setStep("starting");
    try {
      const me = await loadMe();
      const result = await changeKey(me, setStep);
      setOutcome(result);
      if (result === "changed") refresh();
    } catch (caught) {
      setError(userMessage(caught, m));
    } finally {
      setStep(null);
      busy.current = false;
    }
  }

  return { change, working: step !== null, outcome, status: statusText(m, step, outcome), error };
}

/**
 * The button, and under it what is happening or happened, and what went wrong. Both lines are in the page from the
 * start, empty, so that a screen reader announces what they come to say. The button is a secondary one: the screen's
 * primary is its own (Aportar, Pasar a pesos).
 */
function KeyChangeAction({ keyChange }: { keyChange: ReturnType<typeof useKeyChange> }) {
  const m = useMessages();
  const { change, working, outcome, status, error } = keyChange;
  return (
    <>
      {outcome !== "changed" && (
        <Button variant="secondary" disabled={working || outcome !== "open"} onClick={change}>
          {m.keyChange.button}
        </Button>
      )}
      <div>
        <p role="status" className="font-semibold">
          {status}
        </p>
        <p role="alert" className="text-sm text-owe">
          {error}
        </p>
      </div>
    </>
  );
}

/**
 * The request on the inicio (spec, 9.5): update your passkey, with "Ahora no", which hides it for this browser session.
 * Once the change is done it stays on screen as the confirmation, even though the refreshed page no longer asks (`due`).
 */
export function KeyChangeCard({ due, resume }: KeyChangeAsk) {
  const m = useMessages();
  const keyChange = useKeyChange(resume); // the inicio is where the page loads: Tu cuenta opens over it, and doesn't ask again
  // The server can't know what this browser's session said, so the card is on the page until it's read.
  const [later, setLater] = useState(false);
  useEffect(() => {
    setLater(saidLater());
  }, []);
  const done = keyChange.outcome === "changed";
  if (!done && (!due || later)) return null;
  return (
    <Card className="grid gap-3">
      {!done && (
        <div className="grid gap-1.5">
          <CardTitle>{resume ? m.keyChange.resume : m.keyChange.title}</CardTitle>
          <p>{m.keyChange.lead}</p>
          <p className="text-sm text-muted">{m.keyChange.twice}</p>
        </div>
      )}
      <KeyChangeAction keyChange={keyChange} />
      {!done && (
        <Button
          variant="link"
          disabled={keyChange.working}
          onClick={() => {
            sayLater();
            setLater(true);
          }}
        >
          {m.keyChange.later}
        </Button>
      )}
    </Card>
  );
}

/** The same request in Tu cuenta (spec, 9.5), where a person goes on purpose: so no "Ahora no". */
export function KeyChangeSection({ due, resume }: KeyChangeAsk) {
  const m = useMessages();
  const heading = useId();
  const keyChange = useKeyChange();
  const done = keyChange.outcome === "changed";
  if (!done && !due) return null;
  return (
    <section aria-labelledby={heading} className="grid gap-2">
      {!done && (
        <>
          <h3 id={heading} className="text-sm font-semibold text-muted">
            {resume ? m.keyChange.resume : m.keyChange.title}
          </h3>
          <p>{m.keyChange.lead}</p>
          <p className="text-sm text-muted">{m.keyChange.twice}</p>
        </>
      )}
      <KeyChangeAction keyChange={keyChange} />
    </section>
  );
}
