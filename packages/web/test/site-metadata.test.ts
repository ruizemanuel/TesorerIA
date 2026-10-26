import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { siteMetadata } from "../src/lib/site-metadata";

describe("siteMetadata", () => {
  it("gives the link preview its absolute base, the name and the page's language", () => {
    const metadata = siteMetadata(es, "es", "https://tesoreria.finance");
    expect(String(metadata.metadataBase)).toBe("https://tesoreria.finance/");
    expect(metadata.title).toBe("TesorerIA");
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

  it("speaks English to an English request", () => {
    const metadata = siteMetadata(en, "en", "https://tesoreria.finance");
    expect(metadata.description).toBe(en.meta.description);
    expect(metadata.openGraph).toMatchObject({ description: en.meta.description, locale: "en_US" });
  });
});
