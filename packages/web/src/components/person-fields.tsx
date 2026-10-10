import { FIELD } from "./ui";

/** The fields of someone without an account yet: the name the group sees, and a mail for the reminders. */
export function PersonFields() {
  return (
    <>
      <label className="grid gap-1">
        <span className="font-semibold">Tu nombre</span>
        <input className={FIELD} name="person" required maxLength={30} autoComplete="given-name" />
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">Tu mail (opcional, para los avisos)</span>
        <input className={FIELD} name="email" type="email" autoComplete="email" />
      </label>
    </>
  );
}

/** What `PersonFields` collected, the way `createAccount` takes it. */
export function personFrom(form: FormData): { name: string; email?: string } {
  return { name: String(form.get("person") ?? ""), email: String(form.get("email") ?? "") || undefined };
}
