import type { Metadata } from "next";
import type { Locale } from "./i18n/locales";
import type { Messages } from "./i18n/messages";

/**
 * Every page's title, description and link preview (spec, 9.6), in the request's language. The image is
 * app/opengraph-image.png; `origin` makes its URL absolute, which WhatsApp needs. X reads it from og:image.
 */
export function siteMetadata(m: Messages, locale: Locale, origin: string): Metadata {
  const title = "TesorerIA";
  const description = m.meta.description;
  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: { type: "website", siteName: title, title, description, locale: locale === "es" ? "es_AR" : "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}
