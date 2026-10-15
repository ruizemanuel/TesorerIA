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
          setError(userMessage(caught, m));
          setBusy(false);
        }
      }}
    >
      {!hasAccount && <PersonFields />}
      <label className="grid gap-1">
        <span className="font-semibold">{m.create.fundName}</span>
        <input className={FIELD} name="name" required maxLength={40} placeholder={m.create.defaults.fundNamePlaceholder} />
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">{m.create.weeklyFee}</span>
        <input className={`${FIELD} money`} name="weeklyFee" required inputMode="decimal" defaultValue={m.create.defaults.weeklyFee} />
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">{m.create.agreedExpense}</span>
        <input className={FIELD} name="agreedExpense" required maxLength={40} defaultValue={m.create.defaults.agreedExpense} />
        <span className="text-[13px] text-muted">{m.create.agreedExpenseHint}</span>
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">{m.create.weeklyCap}</span>
        <input className={`${FIELD} money`} name="weeklyCap" required inputMode="decimal" defaultValue={m.create.defaults.weeklyCap} />
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? m.create.creating : hasAccount ? m.create.submit : m.create.submitWithPasskey}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </form>
  );
}
