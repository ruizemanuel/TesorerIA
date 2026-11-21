import type { Metadata } from "next";
import type { CountryCode } from "./countries";
import { type Messages, messagesFor } from "./i18n/messages";

const NAME = "TesorerIA";

const IMAGE_SIZE = { width: 1200, height: 630 };

/** The link preview of the pages in neutral Spanish (public/og/neutral.png): app/opengraph-image.png says it in Rioplatense. */
const NEUTRAL_IMAGE = { url: "/og/neutral.png", ...IMAGE_SIZE };

/**
 * A copy of app/opengraph-image.png, byte for byte, for a Rioplatense fund's page on a site whose own Open Graph is the
 * neutral one (fundPageMetadata). A page's own Open Graph can't point at the original: its URL carries a hash that Next
 * writes at build time.
 */
const RIOPLATENSE_IMAGE = { url: "/og/rioplatense.png", ...IMAGE_SIZE };

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
 * twitter, which would replace these whole and drop the image with them (only a fund's page whose preview differs from
 * the site's does, see fundPageMetadata).
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
 * The title and description of a fund's page for its link preview, in the fund's country (spec, 6). `m` is the fund's;
 * `pageCountry` is the one the site's own metadata speaks, the visitor's (getPageCountry). The site's Open Graph is the
 * visitor's, so a fund's preview that differs from it sets the whole of its own, which replaces the site's, and X, which
 * sets nothing here, copies its image from it:
 * - a fund in neutral Spanish always gets its own, the neutral image;
 * - a Rioplatense one, on a page the site speaks in neutral Spanish, gets its own too, with the copy of today's image, so
 *   a member in Mexico who shares an Argentine fund's link doesn't send the neutral preview;
 * - every other fund leaves it to the site's, as before. In English the site's is the same for every country (en_US and
 *   the image of today), and a Rioplatense fund on a Rioplatense page is the site's own.
 */
export function fundPageMetadata(m: Messages, page: { title: string; description: string }, pageCountry: CountryCode): Metadata {
  if (hasOwnImage(m)) return { ...page, openGraph: openGraphOf(m) };
  if (hasOwnImage(messagesFor(m.locale, pageCountry))) {
    return { ...page, openGraph: { ...openGraphOf(m), images: [{ ...RIOPLATENSE_IMAGE, alt: m.meta.imageAlt }] } };
  }
  return page;
}
