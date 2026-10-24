import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { Hex } from "viem";
import { env } from "./env";

export type SessionData = {
  userId?: string;
  challenge?: Hex;
  challengeAt?: number;
  /** The id of the pending passkey this session created or proved it holds, for the key change (spec, 9.5). */
  keyChange?: string;
};

/** What the auth functions need from a session: iron-session's, or a plain object in the tests. */
export type Session = SessionData & { save(): Promise<void>; destroy(): void };

/** The encrypted session cookie: 30 days, httpOnly, sameSite lax, secure on https. */
export async function getSession(): Promise<Session> {
  const { SESSION_SECRET, ORIGIN } = env();
  return getIronSession<SessionData>(await cookies(), {
    password: SESSION_SECRET,
    cookieName: "tesoreria",
    ttl: 60 * 60 * 24 * 30,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: ORIGIN.startsWith("https://"), path: "/" },
  });
}
