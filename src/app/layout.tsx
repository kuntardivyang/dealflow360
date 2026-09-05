import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Manrope } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// next/font bundles the font files at build time, so the app has no runtime CDN dependency.
// Manrope: headings, KPI numbers and the brand. IBM Plex Sans: body and tables (tabular figures).
const display = Manrope({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const body = IBM_Plex_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono-face", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "DealFlow360", template: "%s · DealFlow360" },
  description:
    "Quote-to-cash sales operations: discount governance, automated approvals, warehouse splits, hybrid billing and a customer portal.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
