import { WebAuthnP256 } from "ox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { post } from "../src/lib/client/api";
import { OnItsWayError, UserFacingError, isOnItsWay, userMessage } from "../src/lib/client/errors";

const CANCELLED = "Cancelaste la confirmación. Probá de nuevo.";
const GENERIC = "No se pudo completar. Probá de nuevo en un rato.";

afterEach(() => vi.unstubAllGlobals());

describe("userMessage", () => {
  it("passes through the messages our own code wrote for people", () => {
    expect(userMessage(new UserFacingError("Ese mail no parece válido."))).toBe("Ese mail no parece válido.");
  });

  it("tells an operation that is out and may still land from every other error, and shows its own sentence", () => {
    const cause = new Error("Timed out while waiting for User Operation receipt.");
    const onItsWay = new OnItsWayError({ cause });
    expect(isOnItsWay(onItsWay)).toBe(true);
    expect(onItsWay).toBeInstanceOf(UserFacingError);
    expect(onItsWay.cause).toBe(cause);
    expect(userMessage(onItsWay)).toBe("Tu operación está en camino. En unos minutos la vas a ver reflejada: no la mandes de nuevo.");
    // Anything else, a Spanish message of ours included, is a failure that may be tried again.
    for (const other of [new UserFacingError("Tu passkey no coincide con tu cuenta. Entrá de nuevo."), cause, "en camino", undefined, null]) {
      expect(isOnItsWay(other)).toBe(false);
    }
  });

  it("passes through the Spanish error an API route answered with", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Esa passkey ya tiene una cuenta. Entrá con ella." }, { status: 409 }));
    const caught = await post("/api/auth/register", {}).catch((error: unknown) => error);
    expect(userMessage(caught)).toBe("Esa passkey ya tiene una cuenta. Entrá con ella.");
  });

  it("says something Spanish when the route's answer has no message", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const caught = await post("/api/me").catch((error: unknown) => error);
    expect(userMessage(caught)).toBe("Algo falló. Probá de nuevo.");
  });

  it("turns a cancelled passkey prompt into one sentence, even inside another error", () => {
    expect(userMessage(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"))).toBe(CANCELLED);
    expect(userMessage(new DOMException("Aborted", "AbortError"))).toBe(CANCELLED);
    // ox wraps what the browser threw as the cause of its own error.
    const wrapped = new WebAuthnP256.CredentialRequestFailedError({ cause: new DOMException("not allowed", "NotAllowedError") });
    expect(userMessage(wrapped)).toBe(CANCELLED);
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
      const message = userMessage(leak);
      expect(message).toBe(GENERIC);
      expect(message).not.toMatch(/gas|hash|wallet|blockchain|token|smart account/i);
    }
  });
});
