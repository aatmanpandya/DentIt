import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, IBM_Plex_Sans_Condensed, Figtree } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Self-hosted via next/font at build time — no external requests at runtime.
// See docs/specs/ui-design.md.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-plex-condensed",
  subsets: ["latin"],
  weight: ["600"],
});

// Logo wordmark only (src/components/brand/logo.tsx) — not a UI font.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: "DentIt",
  description: "Practice management for dental clinics.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${plexCondensed.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
