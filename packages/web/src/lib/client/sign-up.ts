import { personProblem } from "../checks";
import type { Messages } from "../i18n/messages";
import { UserFacingError } from "./errors";

type Person = { name: string; email?: string };

/**
 * A form that may make the person's account before what it's for (creating or joining a fund). What the form can
 * tell is wrong (`problem`, and the person's name and mail) is refused before the passkey is made. Once the account
 * is made, `created` lets the form keep `hasAccount` true, so a retry after a later failure (a 409, the network)
 * never makes a second passkey, person and account, nor moves the session to them.
 */
export async function withAccount<T>({
  hasAccount,
  person,
  problem,
  createAccount,
  created,
  then,
  m,
}: {
  hasAccount: boolean;
  person: Person;
  problem: string | null;
  createAccount: (person: Person) => Promise<void>;
  created: () => void;
  then: () => Promise<T>;
  /** The language the person reads: what `personProblem` says is wrong with their name or mail. */
  m: Messages;
}): Promise<T> {
  const issue = problem ?? (hasAccount ? null : personProblem(person, m));
  if (issue !== null) throw new UserFacingError(issue);
  if (!hasAccount) {
    await createAccount(person);
    created();
  }
  return then();
}
