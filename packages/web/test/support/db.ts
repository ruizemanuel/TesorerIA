import { type Address, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { type Db, openDb } from "../../src/lib/db/client";
import { funds, memberships, users } from "../../src/lib/db/schema";

export const WARS = 10n ** 18n;

export function testDb(): Promise<Db> {
  return openDb("memory");
}

/** A throwaway address, as a member's Safe would be. */
export function randomAccount(): Address {
  return getAddress(privateKeyToAddress(generatePrivateKey()));
}

export async function addUser(db: Db, name: string, account: Address = randomAccount()) {
  const [user] = await db.insert(users).values({ name, account }).returning();
  return user!;
}

/** A live fund with these members, in this order: the spec's defaults (4). */
export async function addLiveFund(
  db: Db,
  { creatorId, address, members }: { creatorId: string; address: Address; members: string[] },
) {
  const [fund] = await db
    .insert(funds)
    .values({
      name: "Fútbol de los jueves",
      agreedExpense: "la cancha",
      weeklyFee: 10_000n * WARS,
      weeklyCap: 60_000n * WARS,
      balanceCap: 450_000n * WARS,
      votesRequired: 2,
      creatorId,
      inviteCode: `code-${address}`,
      status: "live",
      address,
      createdBlock: 79_700_000n,
    })
    .returning();
  for (const [i, userId] of members.entries()) {
    await db.insert(memberships).values({ fundId: fund!.id, userId, joinedAt: new Date(Date.UTC(2026, 9, 10, 12, i)) });
  }
  return fund!;
}
