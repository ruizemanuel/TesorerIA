"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { loginMessage } from "../lib/client/errors";
import { logInWithPasskey } from "../lib/client/passkey";
import { useMessages } from "../lib/i18n/client";
import { safeNext } from "../lib/safe-next";
import { Button } from "./ui";

export function LoginButton({ next = "/" }: { next?: string }) {
  const m = useMessages();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="grid gap-2">
      <Button
        disabled={busy}
        onClick={async () => {
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
        }}
      >
        {busy ? m.common.confirm : m.login.button}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </div>
  );
}
