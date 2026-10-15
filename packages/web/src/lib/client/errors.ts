import type { Messages } from "../i18n/messages";

/** The errors the browser makes on its own: their words are in the dictionary (`m.errors`), not in the code. */
export type ErrorKey = "onItsWay" | "cancelled" | "generic" | "noPasskey" | "failed" | "wrongPasskey" | "notCompleted";

/**
 * An error written for the person using the app. A route's comes with its words already in the page's language; one
 * the browser makes comes with a key, and `userMessage` says it in the page's language. It is the only kind
 * `userMessage` shows: everything else (viem, the bundler, the network, WebAuthn) gets a generic sentence, so no
 * technical word reaches the screen (spec, 9.2 and 9.3).
 */
export class UserFacingError extends Error {
  override readonly name: string = "UserFacingError";
  readonly key?: ErrorKey;
  constructor(message: string | { key: ErrorKey }, options?: ErrorOptions) {
    super(typeof message === "string" ? message : message.key, options);
    if (typeof message !== "string") this.key = message.key;
  }
}

/**
 * The operation went out but its receipt or its record never came back: it may well land. It is told apart
 * so nothing sends it again (spec, 6): no second Aportar, and a createFund that went out is never called off.
 */
export class OnItsWayError extends UserFacingError {
  override readonly name: string = "OnItsWayError";
  constructor(options?: ErrorOptions) {
    super({ key: "onItsWay" }, options);
  }
}

export function isOnItsWay(error: unknown): error is OnItsWayError {
  return error instanceof OnItsWayError;
}

/** Whether the person dismissed the passkey prompt: the browser's error, or the one a library wrapped it in. */
export function wasCancelled(error: unknown): boolean {
  for (let depth = 0; depth < 5 && typeof error === "object" && error !== null; depth++) {
    const { name, cause } = error as { name?: unknown; cause?: unknown };
    if (name === "NotAllowedError" || name === "AbortError") return true;
    error = cause;
  }
  return false;
}

/** What to show a person for anything a client call threw, in the page's language. */
export function userMessage(error: unknown, m: Messages): string {
  if (error instanceof UserFacingError) return error.key === undefined ? error.message : m.errors[error.key];
  return wasCancelled(error) ? m.errors.cancelled : m.errors.generic;
}

/**
 * `userMessage`, for logging in. There the browser throws the same error when the person cancels and when this
 * device has no passkey for the site, so it can't be read as a cancel: it says where the passkey may be instead.
 */
export function loginMessage(error: unknown, m: Messages): string {
  return !(error instanceof UserFacingError) && wasCancelled(error) ? m.errors.noPasskey : userMessage(error, m);
}
