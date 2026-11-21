import type { Metadata } from "next";
import type { Messages } from "./i18n/messages";

const NAME = "TesorerIA";

/** The link preview of the pages in neutral Spanish (public/og/neutral.png): app/opengraph-image.png says it in Rioplatense. */
const NEUTRAL_IMAGE = { url: "/og/neutral.png", width: 1200, height: 630 };

type OpenGraph = NonNullable<Metadata["openGraph"]>;

/** Whether `m`'s link preview has an image of its own: neutral Spanish says the phrase in its own words. */
const hasOwnImage = (m: Messages) => m.country.spanish === "neutral" && m.locale === "es";

/**
 * A page's Open Graph (spec, 9.6): its country's locale, and in neutral Spanish its own image. Every other page leaves
 * `images` out altogether, not empty: Next puts app/opengraph-image.png in only while the key is missing.
 */
function openGraphOf(m: Messages): OpenGraph {
  const openGraph: OpenGraph = { type: "website", siteName: NAME, locale: m.country.ogLocale[m.locale] };
  return hasOwnImage(m) ? { ...openGraph, images: [{ ...NEUTRAL_IMAGE, alt: m.meta.imageAlt }] } : openGraph;
}

/**
 * Every page's title, description and link preview (spec, 9.6), in the request's language and for its country. The image
 * is app/opengraph-image.png, or public/og/neutral.png in neutral Spanish; `origin` makes its URL absolute, which
 * WhatsApp needs. X reads it from og:image. A page with a title of its own gets the name after it. Open Graph and X get no
 * title or description here: Next copies in the page's, the name included, as long as the page sets neither openGraph nor
 * twitter, which would replace these whole and drop the image with them (only a fund's page in neutral Spanish does,
 * see fundPageMetadata).
 */
export function siteMetadata(m: Messages, origin: string): Metadata {
  return {
    metadataBase: new URL(origin),
    title: { default: NAME, template: `%s · ${NAME}` },
    description: m.meta.description,
    openGraph: openGraphOf(m),
    twitter: { card: "summary_large_image" },
  };
}

/**
 * The title and description of a fund's page for its link preview, in the fund's country (spec, 6). The site's Open Graph
 * is the visitor's country's, so a fund whose preview has its own image (neutral Spanish) sets the whole of its own,
 * which replaces the site's; X, which sets nothing here, copies its image from it. A fund of any other kind leaves it to
 * the site's, as before.
 */
export function fundPageMetadata(m: Messages, page: { title: string; description: string }): Metadata {
  return hasOwnImage(m) ? { ...page, openGraph: openGraphOf(m) } : page;
}
