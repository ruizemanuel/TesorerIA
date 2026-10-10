/**
 * An error whose message was written, in Spanish, for the person using the app. It is the only kind
 * `userMessage` shows as it is: everything else (viem, the bundler, the network, WebAuthn) gets a generic
 * sentence, so no English and no technical word reaches the screen (spec, 9.2).
 */
export class UserFacingError extends Error {
  override readonly name = "UserFacingError";
}

const CANCELLED = "Cancelaste la confirmación. Probá de nuevo.";
const GENERIC = "No se pudo completar. Probá de nuevo en un rato.";

/** Whether the person dismissed the passkey prompt: the browser's error, or the one a library wrapped it in. */
function wasCancelled(error: unknown): boolean {
  for (let depth = 0; depth < 5 && typeof error === "object" && error !== null; depth++) {
    const { name, cause } = error as { name?: unknown; cause?: unknown };
    if (name === "NotAllowedError" || name === "AbortError") return true;
    error = cause;
  }
  return false;
}

/** What to show a person for anything a client call threw. */
export function userMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  return wasCancelled(error) ? CANCELLED : GENERIC;
}
