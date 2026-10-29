import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { YourTurn } from "../src/components/your-turn";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import type { Messages } from "../src/lib/i18n/messages";
import type { TimelineItem } from "../src/lib/timeline";

// The vote and execute buttons refresh through the app router, which isn't mounted when a test renders on its own.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const FUND = "0x00000000000000000000000000000000000f00d1";

/** A proposal the viewer can vote, as buildTimeline gives it. */
const toVote: TimelineItem = {
  id: "proposal:1",
  at: new Date(Date.UTC(2026, 9, 25)),
  actor: { kind: "member", name: "Ana" },
  text: "Ana propuso pagarle $ 80.000 a Beto por “la cena”. Lleva 1 de 5 votos.",
  action: { kind: "vote", proposalId: 1n, votes: 1, required: 5, canVote: true, voted: false, completes: false },
};

function render(items: TimelineItem[], m: Messages = es) {
  return renderToStaticMarkup(
    createElement(YourTurn, { items, fund: FUND, fundName: "Fondo", now: new Date(Date.UTC(2026, 9, 26)), m, locale: m.locale }),
  );
}

describe("YourTurn (Te toca)", () => {
  it("shows what waits for the viewer under its title, with the row's own button", () => {
    const html = render([toVote]);
    expect(html).toContain("Te toca");
    expect(html).toContain(toVote.text);
    expect(html).toContain(">Votar<");
  });

  it("says it in English too", () => {
    expect(render([toVote], en)).toContain("Your turn");
  });

  it("isn't there when nothing waits for the viewer", () => {
    expect(render([])).toBe("");
  });
});
