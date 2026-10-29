import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { pageMetadata, siteMetadata } from "../src/lib/site-metadata";

describe("siteMetadata", () => {
  it("gives the link preview its absolute base, the name and the page's language", () => {
    const metadata = siteMetadata(es, "es", "https://tesoreria.finance");
    expect(String(metadata.metadataBase)).toBe("https://tesoreria.finance/");
    expect(metadata.description).toBe(es.meta.description);
    expect(metadata.openGraph).toEqual({
      type: "website",
      siteName: "TesorerIA",
      title: "TesorerIA",
      description: es.meta.description,
      locale: "es_AR",
    });
    expect(metadata.twitter).toEqual({ card: "summary_large_image", title: "TesorerIA", description: es.meta.description });
  });

  it("is titled TesorerIA, and a page's own title gets the name after it", () => {
    expect(siteMetadata(es, "es", "https://tesoreria.finance").title).toEqual({ default: "TesorerIA", template: "%s · TesorerIA" });
  });

  it("speaks English to an English request", () => {
    const metadata = siteMetadata(en, "en", "https://tesoreria.finance");
    expect(metadata.description).toBe(en.meta.description);
    expect(metadata.openGraph).toMatchObject({ description: en.meta.description, locale: "en_US" });
  });
});

describe("pageMetadata: a page's own title in its link preview", () => {
  it("leaves the name to the layout's template in the tab, and writes it out where the template doesn't reach: Open Graph and X", () => {
    const metadata = pageMetadata(es, "es", { title: "Crear un fondo" });
    expect(metadata.title).toBe("Crear un fondo");
    expect(metadata.openGraph).toEqual({
      type: "website",
      siteName: "TesorerIA",
      title: "Crear un fondo · TesorerIA",
      description: es.meta.description,
      locale: "es_AR",
    });
    expect(metadata.twitter).toEqual({ card: "summary_large_image", title: "Crear un fondo · TesorerIA", description: es.meta.description });
  });

  it("says the page's own description everywhere, when it has one", () => {
    const description = en.meta.publicDescription("Fútbol de los jueves");
    const metadata = pageMetadata(en, "en", { title: "Fútbol de los jueves", description });
    expect(metadata.description).toBe(description);
    expect(metadata.openGraph).toMatchObject({ title: "Fútbol de los jueves · TesorerIA", description, locale: "en_US" });
    expect(metadata.twitter).toMatchObject({ title: "Fútbol de los jueves · TesorerIA", description });
  });

  it("says the public view and the invitation as approved, in each language", () => {
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
