"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readDraft } from "../lib/checks";
import { post } from "../lib/client/api";
import { userMessage } from "../lib/client/errors";
import { createAccount } from "../lib/client/passkey";
import { withAccount } from "../lib/client/sign-up";
import { useLocale, useMessages } from "../lib/i18n/client";
import { PersonFields, personFrom } from "./person-fields";
import { Button, FIELD } from "./ui";

/** Creating a fund (spec, 9, screen 7). Someone without an account creates it in the same step. */
export function CreateFundForm({ loggedIn }: { loggedIn: boolean }) {
  const router = useRouter();
  const locale = useLocale();
  const m = useMessages();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Once the account is made it stays made, even if what comes after it fails: a retry never makes another.
  const [hasAccount, setHasAccount] = useState(loggedIn);
  return (
    <form
      // Submitted before hydration, it goes out as the browser's own submit: by POST, its fields stay out of the URL.
      method="post"
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const text = (name: string) => String(form.get(name) ?? "");
        const fields = { name: text("name"), agreedExpense: text("agreedExpense"), weeklyFee: text("weeklyFee"), weeklyCap: text("weeklyCap") };
        const draft = readDraft(fields, locale);
        setBusy(true);
        setError("");
        try {
          const { id } = await withAccount({
            hasAccount,
            person: personFrom(form),
            problem: draft.ok ? null : draft.error,
            createAccount,
            created: () => setHasAccount(true),
            then: () => post<{ id: string }>("/api/drafts", fields),
            m,
          });
          router.push(`/f/borrador/${id}`);
        } catch (caught) {
          setError(userMessage(caught));
          setBusy(false);
        }
      }}
    >
      {!hasAccount && <PersonFields />}
      <label className="grid gap-1">
        <span className="font-semibold">Nombre del fondo</span>
        <input className={FIELD} name="name" required maxLength={40} placeholder="Fútbol de los jueves" />
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">Cuota de cada uno por semana</span>
        <input className={`${FIELD} money`} name="weeklyFee" required inputMode="decimal" defaultValue="10.000" />
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">Gasto acordado</span>
        <input className={FIELD} name="agreedExpense" required maxLength={40} defaultValue="la cancha" />
        <span className="text-[13px] text-muted">El agente lo devuelve sin votación, hasta el tope de cada semana.</span>
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">Tope por semana para ese gasto</span>
        <input className={`${FIELD} money`} name="weeklyCap" required inputMode="decimal" defaultValue="60.000" />
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? "Creando…" : hasAccount ? "Crear fondo" : "Crear mi passkey y el fondo"}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </form>
  );
}
