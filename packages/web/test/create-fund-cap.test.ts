import { describe, expect, it } from "vitest";
import { claimCreateFundNonce, createFundRoom } from "../src/lib/create-fund-cap";
import { createFundNonces } from "../src/lib/db/schema";
import { addUser, testDb } from "./support/db";

describe("createFundRoom: whether the paymaster would sign a createFund on a nonce, without claiming it (M5)", () => {
  it("says which cap stops a new nonce: the creator's 3, ever, or the day's among everyone", async () => {
    const db = await testDb();
    const [ana, bea] = [await addUser(db, "Ana"), await addUser(db, "Bea")];
    expect(await createFundRoom(db, ana.id, 0n, 4)).toBe("ok");
    for (const nonce of [0n, 1n, 2n]) await claimCreateFundNonce(db, ana.id, nonce, 4);
    expect(await createFundRoom(db, ana.id, 3n, 4)).toBe("account");
    expect(await createFundRoom(db, ana.id, 2n, 4)).toBe("ok"); // already signed: signing it again can't make it land twice
    await claimCreateFundNonce(db, bea.id, 0n, 4);
    expect(await createFundRoom(db, bea.id, 1n, 4)).toBe("day");
    expect(await createFundRoom(db, bea.id, 0n, 4)).toBe("ok");
    expect(await createFundRoom(db, bea.id, 1n, 5)).toBe("ok"); // a higher limit lets it through at once
    expect(await db.$count(createFundNonces)).toBe(4); // it claims nothing
  });

  it("names the creator's own cap when both are reached: the day's would send them back tomorrow for nothing", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    for (const nonce of [0n, 1n, 2n]) await claimCreateFundNonce(db, ana.id, nonce, 3);
    expect(await createFundRoom(db, ana.id, 3n, 3)).toBe("account");
  });

  it("counts the day back from now: a day later there's room again", async () => {
    const db = await testDb();
    const [ana, bea] = [await addUser(db, "Ana"), await addUser(db, "Bea")];
    await claimCreateFundNonce(db, ana.id, 0n, 1);
    expect(await createFundRoom(db, bea.id, 0n, 1)).toBe("day");
    await db.update(createFundNonces).set({ createdAt: new Date(Date.now() - 86_400_000 - 60_000) });
    expect(await createFundRoom(db, bea.id, 0n, 1)).toBe("ok");
  });

  it("agrees with the claim at every step, so 'Crear fondo' never says one thing and the paymaster another", async () => {
    const db = await testDb();
    const people = [await addUser(db, "Ana"), await addUser(db, "Bea"), await addUser(db, "Ceci")];
    // [who, nonce], with a limit of 5 a day: new ones, Ana's fourth, the day's sixth, and one of Ana's again.
    const tries: [number, bigint][] = [[0, 0n], [0, 1n], [1, 0n], [0, 2n], [0, 3n], [2, 0n], [1, 1n], [0, 1n], [2, 1n]];
    const signed: boolean[] = [];
    for (const [who, nonce] of tries) {
      const person = people[who]!;
      const room = await createFundRoom(db, person.id, nonce, 5);
      const claimed = await claimCreateFundNonce(db, person.id, nonce, 5);
      expect(claimed, `${person.name}, nonce ${nonce}`).toBe(room === "ok");
      signed.push(claimed);
    }
    expect(signed).toEqual([true, true, true, true, false, true, false, true, false]);
  });
});
