"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "../lib/client/errors";
import { logInWithPasskey } from "../lib/client/passkey";
import { Button } from "./ui";

export function LoginButton({ next = "/" }: { next?: string }) {
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
            router.replace(next);
            router.refresh();
          } catch (caught) {
            setError(userMessage(caught));
            setBusy(false);
          }
        }}
      >
        {busy ? "Confirmá con tu huella, tu cara o el PIN" : "Entrar con mi passkey"}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </div>
  );
}
