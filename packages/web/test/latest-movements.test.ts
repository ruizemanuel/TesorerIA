import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LatestMovements, movementsPath } from "../src/components/latest-movements";
import { es } from "../src/lib/i18n/es";
import type { TimelineItem } from "../src/lib/timeline";

// The vote and execute buttons refresh through the app router, which isn't mounted when a test renders on its own.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const FUND = "0x00000000000000000000000000000000000f00d1";

/** `count` contributions, newest first, as buildTimeline gives them. */
function items(count: number): TimelineItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `contribution:${i}`,
    at: new Date(Date.UTC(2026, 9, 25) - i * 60_000),
    actor: { kind: "member", name: `Miembro ${i + 1}` },
    text: `Movimiento número ${i + 1}.`,
  }));
}

function render(count: number, shown: number) {
  return renderToStaticMarkup(
    createElement(LatestMovements, {
      items: items(count),
      shown,
      href: `/f/${FUND}/movimientos`,
      fund: FUND,
      fundName: "Fondo",
      now: new Date(Date.UTC(2026, 9, 26)),
      m: es,
      locale: "es",
    }),
  );
}

describe("LatestMovements", () => {
  it("shows the newest ones up to its limit, and Ver todos to the rest", () => {
    const html = render(10, 8);
    expect(html.match(/<li/g)).toHaveLength(8);
    expect(html).toContain("Movimiento número 8.");
    expect(html).not.toContain("Movimiento número 9.");
    expect(html).toContain(`href="/f/${FUND}/movimientos"`);
    expect(html).toContain("Ver todos");
  });

  it("has no Ver todos when every movement already shows", () => {
    for (const count of [8, 3, 0]) {
      const html = render(count, 8);
      expect(html, String(count)).not.toContain("Ver todos");
    }
  });
});

describe("movementsPath", () => {
  it("is Movimientos for a member, and the public view's own list for anyone else", () => {
    expect(movementsPath(FUND, false)).toBe(`/f/${FUND}/movimientos`);
    expect(movementsPath(FUND, true)).toBe(`/f/${FUND}/publico/movimientos`);
  });
});
