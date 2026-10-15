"use client";

import { useMessages } from "../lib/i18n/client";
import { FIELD } from "./ui";

/**
 * The fields of someone without an account yet: the name the group sees. No mail until there are reminders to send
 * (spec, 12): the server still takes one, for when it's entered from the account panel.
 */
export function PersonFields() {
  const m = useMessages();
  return (
    <label className="grid gap-1">
      <span className="font-semibold">{m.person.name}</span>
      <input className={FIELD} name="person" required maxLength={30} autoComplete="given-name" />
    </label>
  );
}

/** What `PersonFields` collected, the way `createAccount` takes it. */
export function personFrom(form: FormData): { name: string } {
  return { name: String(form.get("person") ?? "") };
}
