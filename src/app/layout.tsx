import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Komatsu Regulatory Risk Dashboard",
  description: "Import, review, prioritise and assign regulatory alerts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)] font-[var(--font-inter)]">
        {children}
      </body>
    </html>
  );
}
