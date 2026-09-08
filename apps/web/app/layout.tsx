import type { Metadata } from "next";
import localFont from "next/font/local";
import { SITE } from "@/lib/site";
import "./globals.css";

const spaceGrotesk = localFont({
  src: [
    { path: "../public/fonts/space-grotesk-400.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/space-grotesk-500.ttf", weight: "500", style: "normal" },
    { path: "../public/fonts/space-grotesk-600.ttf", weight: "600", style: "normal" },
    { path: "../public/fonts/space-grotesk-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-space-grotesk",
  display: "optional",
  preload: true,
  fallback: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: SITE.title,
  description: SITE.description,
  openGraph: {
    title: SITE.title,
    description: SITE.description,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: SITE.title,
    description: SITE.description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
