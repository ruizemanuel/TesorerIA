"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "../lib/client/api";
import { userMessage } from "../lib/client/errors";
import { createAccount } from "../lib/client/passkey";
import { withAccount } from "../lib/client/sign-up";
import { useMessages } from "../lib/i18n/client";
import { PersonFields, personFrom } from "./person-fields";
import { Button } from "./ui";

/** Joining a fund by its link (spec, 9, screen 1), creating the account first if there's none. */
export function JoinForm({ code, loggedIn }: { code: string; loggedIn: boolean }) {
  const router = useRouter();
  const m = useMessages();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Once the account is made it stays made, even if the join fails: a retry never makes another.
  const [hasAccount, setHasAccount] = useState(loggedIn);
  return (
    <form
      // Submitted before hydration, it goes out as the browser's own submit: by POST, its fields stay out of the URL.
      method="post"
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const joined = await withAccount({
            hasAccount,
            person: personFrom(form),
            problem: null,
            createAccount,
            created: () => setHasAccount(true),
            then: () => post<{ fundId: string; status: string; address: string | null }>(`/api/invites/${encodeURIComponent(code)}/join`),
            m,
          });
          router.push(joined.address ? `/f/${joined.address}` : `/f/borrador/${joined.fundId}`);
        } catch (caught) {
          setError(userMessage(caught));
          setBusy(false);
        }
      }}
    >
      {!hasAccount && (
        <>
          <PersonFields />
          <p className="text-[13px] text-muted">
            Tu cuenta se protege con una passkey: tu huella, tu cara o el PIN del teléfono. No hay contraseña ni frase para guardar.
          </p>
        </>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Confirmá con tu huella, tu cara o el PIN" : "Sumarme"}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </form>
  );
}
