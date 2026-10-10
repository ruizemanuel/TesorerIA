import { eq } from "drizzle-orm";
import { type Address, getAddress } from "viem";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { getSession } from "./session";

export type CurrentUser = { id: string; name: string; account: Address };

/** Whoever this session belongs to, or null. */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (session.userId === undefined) return null;
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  return user === undefined ? null : { id: user.id, name: user.name, account: getAddress(user.account) };
}
