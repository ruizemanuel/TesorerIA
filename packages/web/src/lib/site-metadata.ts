import type { Metadata } from "next";
import type { Locale } from "./i18n/locales";
import type { Messages } from "./i18n/messages";

const NAME = "TesorerIA";

/** The link preview's Open Graph and X parts, which a page that has its own title must write out whole. */
function preview(m: Messages, locale: Locale, title: string, description: string): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: { type: "website", siteName: NAME, title, description, locale: locale === "es" ? "es_AR" : "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Every page's title, description and link preview (spec, 9.6), in the request's language. The image is
 * app/opengraph-image.png; `origin` makes its URL absolute, which WhatsApp needs. X reads it from og:image. A page
 * with its own title gets the name after it (pageMetadata).
 */
export function siteMetadata(m: Messages, locale: Locale, origin: string): Metadata {
  const description = m.meta.description;
  return {
    metadataBase: new URL(origin),
    title: { default: NAME, template: `%s · ${NAME}` },
    description,
    ...preview(m, locale, NAME, description),
  };
}

/**
 * A page's own title, and its description if it has one. The layout's template adds the name in the tab, but not in
 * Open Graph or on X: a page's openGraph replaces the layout's whole, so it's written out here with the name.
 */
export function pageMetadata(m: Messages, locale: Locale, { title, description = m.meta.description }: { title: string; description?: string }): Metadata {
  return { title, description, ...preview(m, locale, `${title} · ${NAME}`, description) };
}
