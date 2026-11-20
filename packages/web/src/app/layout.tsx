import type { Metadata, Viewport } from "next";
import { Encode_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { COUNTRIES } from "../lib/countries";
import { env } from "../lib/env";
import { LocaleProvider } from "../lib/i18n/client";
import { getLocale, getMessages, getPageCountry } from "../lib/i18n/server";
import { siteMetadata } from "../lib/site-metadata";
import "./globals.css";

// One variable family: width 75–125 %, weight 100–900. `axes` only works without `weight`.
const encodeSans = Encode_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-encode-sans" });

export async function generateMetadata(): Promise<Metadata> {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return siteMetadata(m, locale, env().ORIGIN);
}

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

/**
 * Every page, in the language of its request (spec, 9.3), for the country of its IP when it's offered (spec, 6): a
 * fund's pages speak the fund's instead (f/[address]/layout.tsx). Reading the cookie renders each page per request, as
 * they already were.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, country] = await Promise.all([getLocale(), getPageCountry()]);
  return (
    <html lang={COUNTRIES[country].htmlLang[locale]} className={encodeSans.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <LocaleProvider locale={locale} country={country}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
