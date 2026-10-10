import type { Metadata, Viewport } from "next";
import { Encode_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// One variable family: width 75–125 %, weight 100–900. `axes` only works without `weight`.
const encodeSans = Encode_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-encode-sans" });

export const metadata: Metadata = {
  title: "TesorerIA",
  description: "La plata del grupo, sin tesorero.",
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR" className={encodeSans.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
