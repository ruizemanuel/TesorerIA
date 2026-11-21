import { USDT, WARS as WARS_TOKEN } from "@tesoreria/agent";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { TimelineList } from "../src/components/timeline-list";
import { COUNTRIES } from "../src/lib/countries";
import { countryCodeOf } from "../src/lib/fund-country";
import type { Locale } from "../src/lib/i18n/locales";
import { messagesFor } from "../src/lib/i18n/messages";
import { type TimelineItem, buildTimeline } from "../src/lib/timeline";
import { AGENT, ANA, BLOCK, FUND, WARS, event } from "./support/fixtures";
import { es } from "./support/messages";

// The button refreshes the page through the app router, which isn't mounted when a test renders on its own.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

/** The movements with one request to join, as buildTimeline gives it, rendered with these options. */
function render({ readOnly = false, closed = false, canPropose = true }: { readOnly?: boolean; closed?: boolean; canPropose?: boolean } = {}) {
  return renderToStaticMarkup(
    createElement(TimelineList, {
      items: [
        {
          id: "join:lucas",
          at: new Date(),
          actor: { kind: "member", name: "Lucas" },
          text: es.timeline.joinRequest("Lucas"),
          action: {
            kind: "propose-member",
            account: "0x000000000000000000000000000000000000aaa4",
            canPropose,
            headsUp: es.timeline.joinRequestSameName("Lucas"),
          },
        },
      ],
      fund: "0x00000000000000000000000000000000000f00d1",
      fundName: "Fondo",
      now: new Date(),
      readOnly,
      closed,
      m: es,
    }),
  );
}

describe("TimelineList: a request to join whose name is someone else's", () => {
  it("shows the heads-up under the sentence, with Proponer sumarlo", () => {
    const html = render();
    expect(html).toContain("Lucas pidió sumarse al fondo.");
    expect(html).toContain("Ojo: hay otra persona que se llama Lucas.");
    expect(html).toContain("Proponer sumarlo");
    expect(html.indexOf("Lucas pidió sumarse")).toBeLessThan(html.indexOf("Ojo: hay otra persona"));
  });

  it("shows it exactly when the button shows: not read-only, not closed, not while the fund can't take the proposal", () => {
    for (const options of [{ readOnly: true }, { closed: true }, { canPropose: false }]) {
      const html = render(options);
      expect(html, JSON.stringify(options)).toContain("Lucas pidió sumarse al fondo.");
      expect(html, JSON.stringify(options)).not.toContain("Proponer sumarlo");
      expect(html, JSON.stringify(options)).not.toContain("Ojo: hay otra persona");
    }
  });
});

/** Two movements with a link each, the way buildTimeline gives a contribution and a closed week. */
function withLinks() {
  const items: TimelineItem[] = [
    {
      id: "0xaaa:1",
      at: new Date(),
      actor: { kind: "member", name: "Ana" },
      text: es.timeline.contributed("Ana", "$ 10.000"),
      action: { kind: "receipt", tx: "0x00000000000000000000000000000000000000000000000000000000000000a1" },
    },
    { id: "summary:2", at: new Date(), actor: { kind: "agent" }, text: es.timeline.weekClosed(3), action: { kind: "summary", week: 2 } },
    {
      id: "0xbbb:4",
      at: new Date(),
      actor: { kind: "member", name: "Beto" },
      text: es.timeline.contributed("Beto", "10 USDT"),
      action: { kind: "receipt", tx: "0x00000000000000000000000000000000000000000000000000000000000000b2" },
    },
  ];
  return createElement(TimelineList, { items, fund: "0x00000000000000000000000000000000000f00d1", fundName: "Fondo", now: new Date(), m: es });
}

/** Each link of the markup, by its text: what it says it's about (aria-describedby) and its classes. */
function links(html: string, text: string) {
  return [...html.matchAll(new RegExp(`<a ([^>]*)>${text}</a>`, "g"))].map(([, attributes]) => ({
    describedBy: /aria-describedby="([^"]*)"/.exec(attributes!)?.[1],
    className: /class="([^"]*)"/.exec(attributes!)?.[1] ?? "",
  }));
}

/** The text of the paragraph with this id. */
function textOf(html: string, id: string): string | undefined {
  const at = html.indexOf(` id="${id}"`);
  if (at === -1 || html.lastIndexOf("<p ", at) !== html.lastIndexOf("<", at)) return undefined;
  const start = html.indexOf(">", at) + 1;
  return html.slice(start, html.indexOf("</p>", start));
}

describe("TimelineList: the links under a movement", () => {
  it("say which movement they're about, for a screen reader: their own row's sentence, not the one above", () => {
    const html = renderToStaticMarkup(withLinks());
    const receipts = links(html, "Ver comprobante");
    expect(receipts).toHaveLength(2);
    expect(textOf(html, receipts[0]!.describedBy!)).toBe(es.timeline.contributed("Ana", "$ 10.000"));
    expect(textOf(html, receipts[1]!.describedBy!)).toBe(es.timeline.contributed("Beto", "10 USDT"));
    const [summary] = links(html, "Ver el resumen");
    expect(textOf(html, summary!.describedBy!)).toBe(es.timeline.weekClosed(3));
  });

  it("give every sentence an id of its own, also with the list twice on a page (the inicio's phone and desktop lists)", () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, withLinks(), withLinks()));
    const ids = [...html.matchAll(/ id="([^"]*)"/g)].map(([, id]) => id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("keep their 44 px to tap inside their own row: no negative margin pushes them down to the next one", () => {
    const html = renderToStaticMarkup(withLinks());
    for (const link of [...links(html, "Ver comprobante"), ...links(html, "Ver el resumen")]) {
      expect(link.className).toContain("min-h-11");
      expect(link.className.split(" ")).not.toContainEqual(expect.stringMatching(/^-mb-/));
    }
  });
});

describe("TimelineList: when a movement happened, on its fund's clock", () => {
  // 2026-10-10 06:30 UTC: 3:30 that day in Buenos Aires, 0:30 that day in Mexico City. The contribution, two hours
  // before, was at 1:30 in Buenos Aires and at 22:30 the day before in Mexico City.
  const now = new Date(Date.UTC(2026, 9, 10, 6, 30));
  const clock = { block: BLOCK, timestamp: BigInt(now.getTime() / 1000) };
  const WMXN = COUNTRIES.MX.currency.token;

  /**
   * The movements of a version 2 fund in `currency`, with one contribution of Ana's two hours before `now`, as its
   * page renders them in `locale`: in the dictionary of its currency's country (loadFundScreen's countryCodeOf).
   */
  function rendered(currency: Address, locale: Locale): string {
    const m = messagesFor(locale, countryCodeOf(currency));
    const items = buildTimeline({
      events: [event("Contribution", { member: ANA, token: currency, amount: 100n * WARS, credited: 100n * WARS }, BLOCK - 7_200n)],
      clock,
      agent: AGENT,
      names: new Map([[ANA, "Ana"]]),
      agreedExpense: "la cancha",
      initialWeeklyCap: 600n * WARS,
      startTime: clock.timestamp - 86_400n,
      votesRequired: 2,
      memberCount: 3,
      proposals: new Map(),
      expenses: [],
      pending: [],
      dollar: currency === WMXN ? null : USDT,
      currencyBalance: 100n * WARS,
      version: 2,
      feeBps: 25,
      viewerIsMember: true,
      now,
      m,
    });
    return renderToStaticMarkup(createElement(TimelineList, { items, fund: FUND, fundName: "Fondo", now, m }));
  }

  it("says the same instant on Mexico City's clock in a wMXN fund, in either language, and on Buenos Aires's in a wARS one", () => {
    const mexican = rendered(WMXN, "es");
    expect(mexican).toContain("Ana aportó $100.");
    expect(mexican).toContain("Ayer, 22:30");
    expect(mexican).not.toContain("Hoy, 1:30");
    expect(rendered(WMXN, "en")).toContain("Yesterday, 22:30");
    const argentine = rendered(WARS_TOKEN, "es");
    expect(argentine).toContain("Hoy, 1:30");
    expect(argentine).not.toContain("22:30");
  });
});
