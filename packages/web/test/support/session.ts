import type { Session } from "../../src/lib/session";

/** A session as iron-session gives it, kept in memory. */
export function fakeSession(): Session & { saved: number } {
  const session = {
    saved: 0,
    async save() {
      session.saved += 1;
    },
    destroy() {
      session.userId = undefined;
    },
  } as Session & { saved: number };
  return session;
}
