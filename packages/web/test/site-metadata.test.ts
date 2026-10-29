import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { siteMetadata } from "../src/lib/site-metadata";

describe("siteMetadata", () => {
  it("gives the link preview its absolute base, the name and the page's language", () => {
    const metadata = siteMetadata(es, "es", "https://tesoreria.finance");
    expect(String(metadata.metadataBase)).toBe("https://tesoreria.finance/");
    expect(metadata.description).toBe(es.meta.description);
    expect(metadata.twitter).toEqual({ card: "summary_large_image" });
  });

  it("is titled TesorerIA, and a page's own title gets the name after it", () => {
    expect(siteMetadata(es, "es", "https://tesoreria.finance").title).toEqual({ default: "TesorerIA", template: "%s · TesorerIA" });
  });

  it("leaves Open Graph's title and description to each page's, which Next copies in with the name: a title of its own would stop it", () => {
    expect(siteMetadata(es, "es", "https://tesoreria.finance").openGraph).toEqual({ type: "website", siteName: "TesorerIA", locale: "es_AR" });
  });

  it("speaks English to an English request", () => {
    const metadata = siteMetadata(en, "en", "https://tesoreria.finance");
    expect(metadata.description).toBe(en.meta.description);
    expect(metadata.openGraph).toMatchObject({ locale: "en_US" });
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
