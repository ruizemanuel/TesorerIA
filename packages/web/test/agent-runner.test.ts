import { describe, expect, it } from "vitest";
import { saveDecisions } from "../src/lib/agent-runner";
import { decisions } from "../src/lib/db/schema";
import { FUND } from "./support/fixtures";
import { testDb } from "./support/db";

describe("saveDecisions", () => {
  it("keeps a skipped conversion's code, and none for a decision without one", async () => {
    const db = await testDb();
    await saveDecisions(db, [
      { fund: FUND, kind: "skip", code: "price-reference", reason: "Chainlink's USD / ARS is 30.0 hours old (26 at most)" },
      { fund: FUND, kind: "blocked", reason: "Could not run the fund: timeout" },
    ]);
    const rows = await db.select().from(decisions).orderBy(decisions.id);
    expect(rows.map(({ kind, code }) => ({ kind, code }))).toEqual([
      { kind: "skip", code: "price-reference" },
      { kind: "blocked", code: null },
    ]);
  });
});
