import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TimelineList } from "../src/components/timeline-list";
import { es } from "../src/lib/i18n/es";

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
