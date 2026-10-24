import { sendKeyChange, signPasskeyChallenge } from "@tesoreria/wallet";
import type { Hash, Hex } from "viem";
import { post } from "./api";
import { RefusedError, UserFacingError, wasCancelled } from "./errors";
import { createPasskey, freshChallenge } from "./passkey";
import { type Me, celoBrowserClient, memberAccount, memberBundlerClient, recordDone } from "./wallet";

export type KeyChangeStep = "create" | "prove" | "sign" | "confirm";

/**
 * What a member's key change goes through (spec, 9.5), from where `/api/me` says they are:
 * - a change is on its way, or landed: only `confirm`, which asks the chain. Nothing is made or sent again;
 * - no pending passkey and none due: nothing. The swap landed and /api/me confirmed it before this tap, or the
 *   change isn't theirs to make: a passkey made now would be one the server refuses, left in the phone's list;
 * - no pending passkey: `create` it (a passkey of the new site, kept as the pending one), `sign` the swap with the
 *   passkey the Safe holds, `confirm`;
 * - a pending passkey this session made or proved (`ready`): `sign`, `confirm`;
 * - a pending passkey from another visit: `prove` this device holds it first, then `sign`, `confirm`.
 */
export function keyChangeSteps({ keyChange }: Me): KeyChangeStep[] {
  if (keyChange.onItsWay) return ["confirm"];
  if (keyChange.pending === null) return keyChange.due ? ["create", "sign", "confirm"] : [];
  return keyChange.ready ? ["sign", "confirm"] : ["prove", "sign", "confirm"];
}

/**
 * Swaps the Safe's passkey for one of the new site, going through `keyChangeSteps` and telling `onStep` before each.
 * "changed" once the chain shows the Safe holds the new key; "waiting" if it doesn't yet, and also whenever the
 * chain can't be asked. By then the swap may be out, so the answer is never an error that invites sending it again:
 * the next `/api/me` confirms it from the chain.
 *
 * It throws only what happened before the swap left (the person cancelled, the bundler refused it, the server
 * wouldn't start), or a swap that landed and failed. A `prove` the device can't answer, because the pending passkey
 * is on another phone, goes back to `create`: the Safe is never left with a key nobody holds, since the pending
 * passkey is replaced only when no swap to it could have been sent.
 *
 * With no steps at all (`keyChangeSteps`), the passkey the Safe holds is the active one `/api/me` names: "changed"
 * if it is of the site the server makes passkeys for, as when the swap landed before this tap. If it is still of
 * another, there is nothing the person can change yet, and it throws, as the server would refuse the start.
 */
export async function changeKey(me: Me, onStep?: (step: KeyChangeStep) => void): Promise<"changed" | "waiting"> {
  const steps = keyChangeSteps(me);
  if (steps.length === 0) {
    const { rpId } = await freshChallenge(); // the site the server makes passkeys for: the new one
    if (me.credential.rpId !== rpId) throw new UserFacingError({ key: "generic" });
    return "changed";
  }
  let publicKey = me.keyChange.pending?.publicKey; // the key to swap to
  for (;;) {
    const step = steps.shift() ?? "confirm";
    onStep?.(step);
    switch (step) {
      case "create":
        publicKey = await start(me);
        // The server won't start: a change is on its way, or the Safe already holds the pending key. The chain decides.
        if (publicKey === undefined) steps.splice(0, steps.length, "confirm");
        break;
      case "prove":
        if (!(await proves(me.keyChange.pending!))) steps.unshift("create");
        break;
      case "sign":
        if (publicKey === undefined) throw new Error("There is no pending passkey to swap the key to");
        await swap(me, publicKey);
        break;
      case "confirm":
        return confirm();
    }
  }
}

/** Makes the new passkey and keeps it as the pending one: the key to swap to, or undefined when the server won't start (409). */
async function start(me: Me): Promise<Hex | undefined> {
  const passkey = await createPasskey(me.name);
  try {
    return (await post<{ publicKey: Hex }>("/api/auth/key", passkey)).publicKey;
  } catch (error) {
    if (error instanceof RefusedError && error.status === 409) return undefined;
    if (error instanceof RefusedError && error.status === 503) throw new UserFacingError({ key: "generic" }); // the chain couldn't be read: try again later
    throw error;
  }
}

/**
 * Whether this device holds the pending passkey, shown by answering a fresh challenge with it, for its own site. The
 * browser says the same when the person has no such passkey here as when they dismiss the prompt, so both are false.
 */
async function proves(pending: { id: string; rpId: string }): Promise<boolean> {
  const { challenge } = await freshChallenge();
  let assertion: Awaited<ReturnType<typeof signPasskeyChallenge>>;
  try {
    assertion = await signPasskeyChallenge({ challenge, credentialId: pending.id, rpId: pending.rpId });
  } catch (error) {
    if (wasCancelled(error)) return false;
    throw error;
  }
  await post("/api/auth/key/prove", assertion);
  return true;
}

/**
 * Sends the swap to `publicKey`, signed with the passkey the Safe holds now, and records it. If it is out but its
 * receipt doesn't come (the wait runs out, or /api/bundler closes its reads because another tab already confirmed
 * it), it returns: the chain says what became of it. An error from before it left is thrown as it is.
 */
async function swap(me: Me, publicKey: Hex): Promise<void> {
  const client = celoBrowserClient();
  const account = await memberAccount(me, client);
  let sent = undefined as Hash | undefined; // the hash as soon as the bundler took the operation, whatever happens next
  let result: Awaited<ReturnType<typeof sendKeyChange>>;
  try {
    result = await sendKeyChange({
      bundlerClient: memberBundlerClient(client),
      account,
      publicKey,
      onSent: async (userOpHash) => {
        sent = userOpHash;
        await post("/api/operations", { kind: "key-change", userOpHash }); // /api/bundler records it too: the same row
      },
    });
  } catch (error) {
    if (sent === undefined) throw error;
    return;
  }
  await recordDone(result);
  if (!result.success) throw new UserFacingError({ key: "notCompleted" });
}

/**
 * What a page that finds a passkey pending (`resume`) does as it loads (spec, 9.5): the swap may have landed after
 * the page that sent it closed, so the server is asked once to confirm it from the chain. Whether the change is
 * done, for the page to refresh and stop asking. Anything else is false and says nothing: the button is still there.
 */
export async function confirmOnLoad(resume: boolean): Promise<boolean> {
  return resume && (await confirm()) === "changed";
}

/**
 * Asks the server to confirm the swap from the chain. Whatever stops it from answering, the swap is still out: "waiting".
 */
async function confirm(): Promise<"changed" | "waiting"> {
  try {
    const { result } = await post<{ result: "changed" | "waiting" | "none" }>("/api/auth/key/confirm");
    // "none": nothing is pending any more because another tab, or /api/me, already made the new passkey the active one.
    return result === "waiting" ? "waiting" : "changed";
  } catch {
    return "waiting";
  }
}
