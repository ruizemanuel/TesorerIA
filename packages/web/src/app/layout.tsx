import type { Metadata, Viewport } from "next";
import { Encode_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { LocaleProvider } from "../lib/i18n/client";
import { getLocale, getMessages } from "../lib/i18n/server";
import "./globals.css";

// One variable family: width 75–125 %, weight 100–900. `axes` only works without `weight`.
const encodeSans = Encode_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-encode-sans" });

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: "TesorerIA", description: m.meta.description };
}

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

/** Every page, in the language of its request (spec, 9.3). Reading the cookie renders each page per request, as they already were. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === "es" ? "es-AR" : "en"} className={encodeSans.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
