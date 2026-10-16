import type { WeekSummaryFacts } from "@tesoreria/agent";
import { type Address, getAddress, pad, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { es } from "../src/lib/i18n/es";
import { whatsAppLink } from "../src/lib/share";
import { weekSummaryText } from "../src/lib/week-summaries";
import { WARS } from "./support/fixtures";

/** What WhatsApp reads from the link: the `text` parameter, decoded. */
const carried = (link: string) => new URL(link).searchParams.get("text");

describe("whatsAppLink: the text, whole, in WhatsApp's link (Review Focus 2)", () => {
  it("carries & # ? % +, line breaks and emoji as they are", () => {
    const text = "TesorerIA · Fútbol & asado #3?\nDeben:\n· Ana+Beto, $ 10.000 (100%) ⚽️🔥";
    const link = whatsAppLink(text);
    expect(link.startsWith("https://wa.me/?text=")).toBe(true);
    expect(new URL(link).hash).toBe(""); // a "#" didn't cut it short
    expect(carried(link)).toBe(text);
  });

  it("carries a summary whose fund name, names and notes have them", () => {
    const [ana, beto] = [1, 2].map((n) => getAddress(pad(toHex(n), { size: 20 }))) as [Address, Address];
    const facts: WeekSummaryFacts = {
      week: 0n,
      block: 1n,
      startsAt: 1_791_764_388n,
      endsAt: 1_791_764_388n + 604_800n,
      balance: 10_000n * WARS,
      dues: [
        { member: ana, owed: 0n },
        { member: beto, owed: 10_000n * WARS },
      ],
      contributed: 10_000n * WARS,
      reimbursements: [],
      payments: [{ member: ana, amount: 5_000n * WARS, note: "pizza #2 + birra 50%\ny la otra?" }],
      joined: [],
    };
    const names = new Map([
      [ana, "Ana & Co"],
      [beto, "Beto 🔥"],
    ]);
    const text = weekSummaryText(facts, { fundName: "Fútbol? ⚽ & asado", agreedExpense: "la cancha", names, link: "https://tesoreriaia.vercel.app/f/0x1" }, es);
    expect(text).toContain("a Ana & Co por pizza #2 + birra 50%\ny la otra?.");
    expect(text).toContain("· Beto 🔥, $");
    expect(carried(whatsAppLink(text))).toBe(text);
  });
});
