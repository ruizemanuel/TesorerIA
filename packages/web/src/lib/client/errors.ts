import type { Messages } from "../i18n/messages";
import type { PasskeySite } from "./passkey";

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
 * A route refused the request. `status` is its HTTP status, for the code that has to tell one refusal from another
 * (a key change reads the 409 and the 503 of its start); everything else shows its words, as any `UserFacingError`.
 */
export class RefusedError extends UserFacingError {
  override readonly name: string = "RefusedError";
  readonly status: number;
  constructor(message: string | { key: ErrorKey }, status: number) {
    super(message);
    this.status = status;
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

/** Whether `error`, or one of the errors it wraps (to a few levels), has one of these names. */
function isNamed(error: unknown, ...names: string[]): boolean {
  for (let depth = 0; depth < 5 && typeof error === "object" && error !== null; depth++) {
    const { name, cause } = error as { name?: unknown; cause?: unknown };
    if (typeof name === "string" && names.includes(name)) return true;
    error = cause;
  }
  return false;
}

/** Whether the person dismissed the passkey prompt: the browser's error, or the one a library wrapped it in. */
export function wasCancelled(error: unknown): boolean {
  return isNamed(error, "NotAllowedError", "AbortError");
}

/**
 * Whether the bundler refused the operation's signature (AA24, viem's `UserOperationSignatureError`): the passkey
 * that signed is not the one the Safe holds now, as after a key change that landed on another phone.
 */
export function wasWrongPasskey(error: unknown): boolean {
  return isNamed(error, "UserOperationSignatureError");
}

/** What to show a person for anything a client call threw, in the page's language. Of viem's errors, only the bundler refusing the signature (AA24) is told apart. */
export function userMessage(error: unknown, m: Messages): string {
  if (error instanceof UserFacingError) return error.key === undefined ? error.message : m.errors[error.key];
  if (wasWrongPasskey(error)) return m.errors.wrongPasskey;
  return wasCancelled(error) ? m.errors.cancelled : m.errors.generic;
}

/**
 * Whether the browser refused the site the passkey was asked for (SecurityError): a phone or browser without Related
 * Origin Requests can't use a passkey of the old site from tesoreria.finance (spec, 9.5).
 */
export function wasSiteRefused(error: unknown): boolean {
  return isNamed(error, "SecurityError");
}

/**
 * `userMessage`, for logging in with a passkey of `site`. There the browser throws the same error when the person
 * cancels and when this device has no passkey for the site, so it can't be read as a cancel: it says where the
 * passkey may be instead. A SecurityError on the old site says the phone is too old for it.
 */
export function loginMessage(error: unknown, m: Messages, site: PasskeySite = "current"): string {
  if (site === "legacy" && wasSiteRefused(error)) return m.login.updateDevice;
  return !(error instanceof UserFacingError) && wasCancelled(error) ? m.errors.noPasskey : userMessage(error, m);
}
