"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { loginMessage } from "../lib/client/errors";
import { logInWithPasskey } from "../lib/client/passkey";
import { useMessages } from "../lib/i18n/client";
import { safeNext } from "../lib/safe-next";
import { Button } from "./ui";

/** Entrar. The button asks for a passkey of the site the server names (the current one, spec 9.5). */
export function LoginButton({ next = "/" }: { next?: string }) {
  const m = useMessages();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logIn() {
    setBusy(true);
    setError("");
    try {
      await logInWithPasskey();
      router.replace(safeNext(next)); // the prop is checked again here: this never leaves the site
      router.refresh();
    } catch (caught) {
      setError(loginMessage(caught, m));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Button disabled={busy} onClick={logIn}>
        {busy ? m.common.confirm : m.login.button}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </div>
  );
}
