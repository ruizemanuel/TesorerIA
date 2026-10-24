"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { loginMessage } from "../lib/client/errors";
import { type PasskeySite, lastPasskeySite, logInWithPasskey } from "../lib/client/passkey";
import { useMessages } from "../lib/i18n/client";
import { safeNext } from "../lib/safe-next";
import { Button } from "./ui";

/**
 * Entrar. The button asks for a passkey of the site the last login worked with (`lastPasskeySite`); while someone still
 * has one of the old site (`legacyOpen`, spec 9.5), a second door under it asks for that site's.
 */
export function LoginButton({ next = "/", legacyOpen = false }: { next?: string; legacyOpen?: boolean }) {
  const m = useMessages();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logIn(site: PasskeySite) {
    setBusy(true);
    setError("");
    try {
      await logInWithPasskey(site);
      router.replace(safeNext(next)); // the prop is checked again here: this never leaves the site
      router.refresh();
    } catch (caught) {
      setError(loginMessage(caught, m, site));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Button disabled={busy} onClick={() => logIn(lastPasskeySite())}>
        {busy ? m.common.confirm : m.login.button}
      </Button>
      {legacyOpen && (
        <Button variant="link" disabled={busy} onClick={() => logIn("legacy")}>
          {m.login.legacyLink}
        </Button>
      )}
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </div>
  );
}
