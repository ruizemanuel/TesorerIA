import { describe, expect, it, vi } from "vitest";
import { UserFacingError, userMessage } from "../src/lib/client/errors";
import { withAccount } from "../src/lib/client/sign-up";
import { en } from "../src/lib/i18n/en";
import { type Messages, es } from "../src/lib/i18n/es";

const PERSON = { name: "Ema", email: "ema@example.com" };
const FULL = new UserFacingError("El fondo ya tiene 10 personas, que es el máximo.");

/** A form's submit, as the form runs it: the account flag is the form's state, kept between tries. */
function form({ loggedIn = false, then = vi.fn(async () => "sent"), m = es as Messages } = {}) {
  let hasAccount = loggedIn;
  const createAccount = vi.fn(async (_: { name: string; email?: string }) => {});
  const submit = (person: { name: string; email?: string }, problem: string | null = null) =>
    withAccount({ hasAccount, person, problem, createAccount, created: () => (hasAccount = true), then, m });
  return { submit, createAccount, then, hasAccount: () => hasAccount };
}

describe("withAccount", () => {
  it("refuses what the form can tell is wrong before making the passkey", async () => {
    const { submit, createAccount, then } = form();
    const bad = await submit(PERSON, "No entendimos la cuota. Escribila como 10.000 o 10.000,50.").catch((error: unknown) => error);
    expect(userMessage(bad)).toBe("No entendimos la cuota. Escribila como 10.000 o 10.000,50.");
    expect(userMessage(await submit({ name: " " }).catch((error: unknown) => error))).toBe("Poné tu nombre, de hasta 30 letras.");
    expect(userMessage(await submit({ name: "Ema", email: "nope" }).catch((error: unknown) => error))).toBe("Ese mail no parece válido.");
    expect(createAccount).not.toHaveBeenCalled();
    expect(then).not.toHaveBeenCalled();
  });

  it("says what is wrong with the person in the language it is given, and takes the form's own problem as it comes", async () => {
    const { submit, createAccount } = form({ m: en });
    expect(userMessage(await submit({ name: " " }).catch((error: unknown) => error))).toBe("Enter your name, up to 30 letters.");
    expect(userMessage(await submit({ name: "Ema", email: "nope" }).catch((error: unknown) => error))).toBe("That email doesn't look valid.");
    const bad = await submit(PERSON, "We couldn't read the weekly dues. Write them like 10,000 or 10,000.50.").catch((error: unknown) => error);
    expect(userMessage(bad)).toBe("We couldn't read the weekly dues. Write them like 10,000 or 10,000.50.");
    expect(createAccount).not.toHaveBeenCalled();
  });

  it("makes the account once: a retry after a later failure goes straight to what failed", async () => {
    const then = vi.fn<() => Promise<string>>().mockRejectedValueOnce(FULL).mockResolvedValueOnce("sent");
    const { submit, createAccount, hasAccount } = form({ then });

    await expect(submit(PERSON)).rejects.toBe(FULL);
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(createAccount).toHaveBeenCalledWith(PERSON);
    expect(hasAccount()).toBe(true); // the form hides the person's fields from here on

    // The fields are gone, so they come back empty: they aren't checked, and no second passkey is made.
    expect(await submit({ name: "" })).toBe("sent");
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(then).toHaveBeenCalledTimes(2);
  });

  it("keeps the flag down when making the account fails, so the next try makes it", async () => {
    const { submit, createAccount, then, hasAccount } = form();
    createAccount.mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError"));
    await expect(submit(PERSON)).rejects.toThrow("cancelled");
    expect(hasAccount()).toBe(false);
    expect(then).not.toHaveBeenCalled();
    expect(await submit(PERSON)).toBe("sent");
    expect(createAccount).toHaveBeenCalledTimes(2);
  });

  it("never makes an account for someone logged in", async () => {
    const { submit, createAccount } = form({ loggedIn: true });
    expect(await submit({ name: "" })).toBe("sent");
    expect(createAccount).not.toHaveBeenCalled();
  });
});
