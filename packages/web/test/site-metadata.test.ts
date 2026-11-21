import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../src/lib/i18n/messages";
import { fundPageMetadata, siteMetadata } from "../src/lib/site-metadata";
import { en, es } from "./support/messages";

const ORIGIN = "https://tesoreria.finance";

describe("siteMetadata", () => {
  it("gives the link preview its absolute base, the name and the page's language", () => {
    const metadata = siteMetadata(es, ORIGIN);
    expect(String(metadata.metadataBase)).toBe("https://tesoreria.finance/");
    expect(metadata.description).toBe(es.meta.description);
    expect(metadata.twitter).toEqual({ card: "summary_large_image" });
  });

  it("is titled TesorerIA, and a page's own title gets the name after it", () => {
    expect(siteMetadata(es, ORIGIN).title).toEqual({ default: "TesorerIA", template: "%s · TesorerIA" });
  });

  it("leaves Open Graph's title and description to each page's, which Next copies in with the name: a title of its own would stop it", () => {
    expect(siteMetadata(es, ORIGIN).openGraph).toEqual({ type: "website", siteName: "TesorerIA", locale: "es_AR" });
  });

  it("speaks English to an English request", () => {
    const metadata = siteMetadata(en, ORIGIN);
    expect(metadata.description).toBe(en.meta.description);
    expect(metadata.openGraph).toMatchObject({ locale: "en_US" });
  });

  it("gives a neutral page Mexico's locale and the neutral image", () => {
    const meta = siteMetadata(messagesFor("es", "MX"), ORIGIN);
    expect(meta.openGraph).toMatchObject({ locale: "es_MX", images: [{ url: "/og/neutral.png", width: 1200, height: 630 }] });
  });

  it("says the neutral image in the neutral alt text", () => {
    const meta = siteMetadata(messagesFor("es", "MX"), ORIGIN);
    expect(meta.openGraph).toMatchObject({ images: [{ alt: "TesorerIA: el dinero del grupo, sin tesorero." }] });
  });

  it("leaves an Argentine page as it is", () => {
    const meta = siteMetadata(messagesFor("es", "AR"), ORIGIN);
    expect(meta.openGraph).toMatchObject({ locale: "es_AR" });
    // Not even an empty `images`: Next puts app/opengraph-image.png in unless the page's own openGraph has the key.
    expect(meta.openGraph).not.toHaveProperty("images");
  });

  it("leaves a Mexican page in English as an English one, with the image of today", () => {
    const meta = siteMetadata(messagesFor("en", "MX"), ORIGIN);
    expect(meta.openGraph).toEqual({ type: "website", siteName: "TesorerIA", locale: "en_US" });
  });
});

describe("a fund's page's own metadata (fundPageMetadata)", () => {
  const page = { title: "Te invitaron a Fútbol de los jueves", description: "Únete al fondo del grupo en TesorerIA." };

  it("is just its title and description for a fund whose preview is the site's own: Next copies them into Open Graph and X", () => {
    for (const [m, pageCountry] of [
      [messagesFor("es", "AR"), "AR"],
      [messagesFor("en", "AR"), "AR"],
      [messagesFor("en", "MX"), "MX"],
      [messagesFor("en", "AR"), "MX"],
      [messagesFor("en", "MX"), "AR"],
    ] as const) {
      const meta = fundPageMetadata(m, page, pageCountry);
      expect(meta).toEqual(page);
      expect(meta).not.toHaveProperty("openGraph");
    }
  });

  it("gives a neutral Spanish fund the site's Open Graph whole, with Mexico's locale and the neutral image, since a page's own replaces the site's", () => {
    for (const pageCountry of ["AR", "MX"] as const) {
      const meta = fundPageMetadata(messagesFor("es", "MX"), page, pageCountry);
      expect(meta).toEqual({
        ...page,
        openGraph: {
          type: "website",
          siteName: "TesorerIA",
          locale: "es_MX",
          images: [{ url: "/og/neutral.png", width: 1200, height: 630, alt: "TesorerIA: el dinero del grupo, sin tesorero." }],
        },
      });
      expect(meta).not.toHaveProperty("twitter");
    }
  });

  it("gives a Rioplatense fund, on a page the site speaks in neutral Spanish, its own Open Graph whole with its locale and a copy of today's image", () => {
    const meta = fundPageMetadata(messagesFor("es", "AR"), page, "MX");
    expect(meta).toEqual({
      ...page,
      openGraph: {
        type: "website",
        siteName: "TesorerIA",
        locale: "es_AR",
        images: [{ url: "/og/rioplatense.png", width: 1200, height: 630, alt: "TesorerIA: la plata del grupo, sin tesorero." }],
      },
    });
    expect(meta).not.toHaveProperty("twitter");
  });

  it("leaves a Rioplatense fund on a Rioplatense page to the site's, byte for byte as before", () => {
    const meta = fundPageMetadata(messagesFor("es", "AR"), page, "AR");
    expect(meta).toEqual(page);
    expect(Object.keys(meta)).toEqual(["title", "description"]);
  });
});

describe("the link preview's images, in public/og", () => {
  /** The width and height a PNG says it has: the two big-endian numbers after its signature and the IHDR tag. */
  const sizeOf = (file: Buffer) => [file.readUInt32BE(16), file.readUInt32BE(20)];
  const read = (path: string) => readFileSync(new URL(path, import.meta.url));

  it("are 1200 by 630, the neutral one and the Rioplatense one", () => {
    expect(sizeOf(read("../public/og/neutral.png"))).toEqual([1200, 630]);
    expect(sizeOf(read("../public/og/rioplatense.png"))).toEqual([1200, 630]);
  });

  it("has the Rioplatense one as a byte-for-byte copy of app/opengraph-image.png, which a page's own Open Graph can't point at (its URL carries a hash)", () => {
    expect(read("../public/og/rioplatense.png").equals(read("../src/app/opengraph-image.png"))).toBe(true);
  });
});

describe("the link preview's alt text, which says what the image says", () => {
  it("is the image's phrase in each dictionary", () => {
    expect(es.meta.imageAlt).toBe("TesorerIA: la plata del grupo, sin tesorero.");
    expect(messagesFor("es", "MX").meta.imageAlt).toBe("TesorerIA: el dinero del grupo, sin tesorero.");
    expect(en.meta.imageAlt).toBe("TesorerIA: the group's treasury, without a treasurer.");
  });
});

describe("the pages' own titles and descriptions", () => {
  it("say the public view and the invitation as approved, in each language", () => {
    expect(es.meta.publicDescription("Fútbol de los jueves")).toBe(
      "Fútbol de los jueves, en vivo: lo que hay en el fondo, quién pagó la cuota y lo que hizo el agente.",
    );
    expect(en.meta.publicDescription("Fútbol de los jueves")).toBe("Fútbol de los jueves, live: what's in the fund, who paid their dues and what the agent did.");
    expect(es.meta.invitationTitle("Fútbol de los jueves")).toBe("Te invitaron a Fútbol de los jueves");
    expect(en.meta.invitationTitle("Fútbol de los jueves")).toBe("You're invited to Fútbol de los jueves");
    expect(es.meta.invitationDescription).toBe("Sumate al fondo del grupo en TesorerIA.");
    expect(en.meta.invitationDescription).toBe("Join the group's fund on TesorerIA.");
  });
});
