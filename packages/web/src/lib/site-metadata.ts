import type { Metadata } from "next";
import type { Locale } from "./i18n/locales";
import type { Messages } from "./i18n/messages";

const NAME = "TesorerIA";

/**
 * Every page's title, description and link preview (spec, 9.6), in the request's language. The image is
 * app/opengraph-image.png; `origin` makes its URL absolute, which WhatsApp needs. X reads it from og:image.
 * A page with a title of its own gets the name after it. Open Graph and X get no title or description here: Next
 * copies in the page's, the name included, as long as the page sets neither openGraph nor twitter, which would replace
 * these whole and drop the image with them.
 */
export function siteMetadata(m: Messages, locale: Locale, origin: string): Metadata {
  return {
    metadataBase: new URL(origin),
    title: { default: NAME, template: `%s · ${NAME}` },
    description: m.meta.description,
    openGraph: { type: "website", siteName: NAME, locale: locale === "es" ? "es_AR" : "en_US" },
    twitter: { card: "summary_large_image" },
  };
}
