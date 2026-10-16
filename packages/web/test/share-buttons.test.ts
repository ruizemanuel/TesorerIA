import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShareLink } from "../src/components/share-link";
import { SummaryPanel } from "../src/components/summary-panel";
import { LocaleProvider } from "../src/lib/i18n/client";
import type { Locale } from "../src/lib/i18n/locales";
import { whatsAppLink } from "../src/lib/share";

const inLocale = (locale: Locale, child: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(LocaleProvider, { locale, children: child }));

/** The WhatsApp link's `text`, as WhatsApp reads it, from the markup of a page. */
function sent(markup: string): string | null {
  const href = /<a [^>]*href="([^"]+)"/.exec(markup)?.[1];
  return href === undefined ? null : new URL(href).searchParams.get("text");
}

describe("ShareLink: the invitation, to send or copy (spec, 9.2)", () => {
  const invitation = (locale: Locale, variant?: "primary" | "secondary") =>
    inLocale(locale, createElement(ShareLink, { url: "https://x.test/invitacion/ab?c=1&d=2", fundName: 'Fútbol & "asado"', variant }));

  it("shows the link, sends the invitation's sentence on WhatsApp and offers to copy the link", () => {
    const markup = invitation("es");
    expect(markup).toContain(">https://x.test/invitacion/ab?c=1&amp;d=2</p>");
    expect(sent(markup)).toBe('Sumate al fondo "Fútbol & "asado"" en TesorerIA: https://x.test/invitacion/ab?c=1&d=2');
    expect(markup).toContain(">Mandar por WhatsApp</a>");
    expect(markup).toContain(">Copiar el link</button>");
    expect(sent(invitation("en"))).toBe('Join the fund "Fútbol & "asado"" on TesorerIA: https://x.test/invitacion/ab?c=1&d=2');
    expect(invitation("en")).toContain(">Copy the link</button>");
  });

  it("makes WhatsApp the one primary button unless the screen has one already", () => {
    const whatsApp = (markup: string) => /<a class="([^"]*)"/.exec(markup)?.[1] ?? "";
    expect(whatsApp(invitation("es"))).toContain("bg-primary");
    expect(whatsApp(invitation("es", "secondary"))).not.toContain("bg-primary");
    expect(invitation("es", "secondary")).not.toContain("bg-primary");
  });
});

describe("SummaryPanel: a week's summary and the two ways to send it (spec, 9.4)", () => {
  const text = "TesorerIA · Fútbol & asado #3?\nDeben:\n· Ana+Beto, $ 10.000 (100%) ⚽️🔥";
  const panel = (locale: Locale, shareable: boolean) => inLocale(locale, createElement(SummaryPanel, { text, shareable }));

  it("shows the text as it goes out, and sends on WhatsApp that same text", () => {
    const markup = panel("es", true);
    expect(markup).toContain("Fútbol &amp; asado #3?\nDeben:");
    expect(sent(markup)).toBe(text);
    expect(markup).toContain(`href="${whatsAppLink(text)}"`);
    expect(markup).toContain(">Mandar por WhatsApp</a>");
    expect(markup).toContain(">Copiar</button>");
    expect(panel("en", true)).toContain(">Send on WhatsApp</a>");
    expect(panel("en", true)).toContain(">Copy</button>");
  });

  it("has WhatsApp as its one primary button", () => {
    const markup = panel("es", true);
    // The primary variant's classes (ui.tsx) carry "bg-primary px-4 text-white"; the secondary's, "bg-tint".
    expect(markup.match(/ bg-primary px-4 text-white/g)).toHaveLength(1);
    expect(/<a class="[^"]* bg-primary px-4 text-white/.test(markup)).toBe(true);
  });

  it("shows the text alone in the public view: nobody to send it to", () => {
    const markup = panel("es", false);
    expect(markup).toContain("Deben:");
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<button");
  });
});
