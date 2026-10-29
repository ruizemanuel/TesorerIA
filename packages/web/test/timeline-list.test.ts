import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TimelineList } from "../src/components/timeline-list";
import { es } from "../src/lib/i18n/es";
import type { TimelineItem } from "../src/lib/timeline";

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
      locale: "es",
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
  return createElement(TimelineList, { items, fund: "0x00000000000000000000000000000000000f00d1", fundName: "Fondo", now: new Date(), m: es, locale: "es" });
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
