import { WebAuthnP256 } from "ox";
import { UserOperationExecutionError, UserOperationSignatureError } from "viem/account-abstraction";
import { afterEach, describe, expect, it, vi } from "vitest";
import { post } from "../src/lib/client/api";
import { OnItsWayError, RefusedError, UserFacingError, isOnItsWay, loginMessage, userMessage } from "../src/lib/client/errors";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";

const CANCELLED = "Cancelaste la confirmación. Probá de nuevo.";
const GENERIC = "No se pudo completar. Probá de nuevo en un rato.";

afterEach(() => vi.unstubAllGlobals());

describe("userMessage", () => {
  it("passes through the messages our own code wrote for people", () => {
    expect(userMessage(new UserFacingError("Ese mail no parece válido."), es)).toBe("Ese mail no parece válido.");
  });

  it("tells an operation that is out and may still land from every other error, and shows its own sentence", () => {
    const cause = new Error("Timed out while waiting for User Operation receipt.");
    const onItsWay = new OnItsWayError({ cause });
    expect(isOnItsWay(onItsWay)).toBe(true);
    expect(onItsWay).toBeInstanceOf(UserFacingError);
    expect(onItsWay.cause).toBe(cause);
    expect(userMessage(onItsWay, es)).toBe("Tu operación está en camino. En unos minutos la vas a ver reflejada: no la mandes de nuevo.");
    // Anything else, a Spanish message of ours included, is a failure that may be tried again.
    for (const other of [new UserFacingError("Tu passkey no coincide con tu cuenta. Entrá de nuevo."), cause, "en camino", undefined, null]) {
      expect(isOnItsWay(other)).toBe(false);
    }
  });

  it("passes through the Spanish error an API route answered with", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Esa passkey ya tiene una cuenta. Entrá con ella." }, { status: 409 }));
    const caught = await post("/api/auth/register", {}).catch((error: unknown) => error);
    expect(userMessage(caught, es)).toBe("Esa passkey ya tiene una cuenta. Entrá con ella.");
  });

  it("keeps the status of a route's refusal, for the code that has to tell them apart", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Probá de nuevo en un rato." }, { status: 503 }));
    const caught = await post("/api/auth/key", {}).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(RefusedError);
    expect(caught).toBeInstanceOf(UserFacingError); // and it is shown like any other
    expect((caught as RefusedError).status).toBe(503);
    expect(userMessage(caught, es)).toBe("Probá de nuevo en un rato.");
  });

  it("says something Spanish when the route's answer has no message", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const caught = await post("/api/me").catch((error: unknown) => error);
    expect(userMessage(caught, es)).toBe("Algo falló. Probá de nuevo.");
  });

  it("turns a cancelled passkey prompt into one sentence, even inside another error", () => {
    expect(userMessage(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"), es)).toBe(CANCELLED);
    expect(userMessage(new DOMException("Aborted", "AbortError"), es)).toBe(CANCELLED);
    // ox wraps what the browser threw as the cause of its own error.
    const wrapped = new WebAuthnP256.CredentialRequestFailedError({ cause: new DOMException("not allowed", "NotAllowedError") });
    expect(userMessage(wrapped, es)).toBe(CANCELLED);
  });

  it("on login, says the passkey may be on another phone, since the browser can't tell that from a cancel", () => {
    const NO_PASSKEY = "No se pudo entrar. Si no te aparece tu passkey, probá desde el teléfono donde creaste tu cuenta.";
    const notAllowed = new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
    expect(loginMessage(notAllowed, es)).toBe(NO_PASSKEY);
    expect(loginMessage(new WebAuthnP256.CredentialRequestFailedError({ cause: notAllowed }), es)).toBe(NO_PASSKEY);
    // Anything else reads as it does everywhere, and everywhere else a cancel is still a cancel.
    expect(loginMessage(new UserFacingError("Esa passkey no tiene una cuenta acá."), es)).toBe("Esa passkey no tiene una cuenta acá.");
    expect(loginMessage(new TypeError("Failed to fetch"), es)).toBe(GENERIC);
    expect(userMessage(notAllowed, es)).toBe(CANCELLED);
  });

  it("on login, a SecurityError reads as any other error: the phone's age is not what it is about", () => {
    const refused = new DOMException("The relying party ID is not a registrable domain suffix of, nor equal to the current domain.", "SecurityError");
    expect(loginMessage(refused, es)).toBe(GENERIC);
    expect(loginMessage(new WebAuthnP256.CredentialRequestFailedError({ cause: refused }), en)).toBe(en.errors.generic);
  });

  it("tells the passkey doesn't match the account when the bundler refuses the signature (AA24)", () => {
    const refused = new UserOperationExecutionError(new UserOperationSignatureError({}), {} as never);
    expect(userMessage(refused, es)).toBe("Tu passkey no coincide con tu cuenta. Entrá de nuevo.");
    expect(userMessage(refused, en)).toBe(en.errors.wrongPasskey);
  });

  it("hides everything else behind a generic sentence", () => {
    const leaks = [
      new Error("UserOperation reverted during simulation: AA23 reverted (gas)"),
      new TypeError("Failed to fetch"),
      new DOMException("A credential with this id already exists", "InvalidStateError"),
      new WebAuthnP256.CredentialCreationFailedError({ cause: new Error("smart account wallet token hash") }),
      "a string",
      undefined,
      null,
    ];
    for (const leak of leaks) {
      const message = userMessage(leak, es);
      expect(message).toBe(GENERIC);
      expect(message).not.toMatch(/gas|hash|wallet|blockchain|token|smart account/i);
    }
  });
});

describe("in each language", () => {
  it("says the browser's own errors from the dictionary, and a route's as the route wrote it", () => {
    expect(userMessage(new OnItsWayError(), es)).toBe("Tu operación está en camino. En unos minutos la vas a ver reflejada: no la mandes de nuevo.");
    expect(userMessage(new OnItsWayError(), en)).toBe(en.errors.onItsWay);
    expect(userMessage(new UserFacingError({ key: "wrongPasskey" }), en)).toBe(en.errors.wrongPasskey);
    expect(userMessage(new UserFacingError("Log in with your passkey."), en)).toBe("Log in with your passkey.");
    expect(userMessage(new Error("viem said something"), en)).toBe(en.errors.generic);
    expect(userMessage(Object.assign(new Error("x"), { name: "NotAllowedError" }), en)).toBe(en.errors.cancelled);
    expect(loginMessage(Object.assign(new Error("x"), { name: "NotAllowedError" }), en)).toBe(en.errors.noPasskey);
  });

  it("keeps what is on its way recognizable, whatever the language", () => {
    expect(isOnItsWay(new OnItsWayError())).toBe(true);
    expect(isOnItsWay(new UserFacingError({ key: "generic" }))).toBe(false);
  });

  it("keeps the key as the message, for the logs, and says a route that answered nothing in the page's language", async () => {
    expect(new UserFacingError({ key: "wrongPasskey" }).message).toBe("wrongPasskey");
    vi.stubGlobal("fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const caught = await post("/api/me").catch((error: unknown) => error);
    expect((caught as UserFacingError).key).toBe("failed");
    expect(userMessage(caught, en)).toBe("Something went wrong. Try again.");
  });
});
