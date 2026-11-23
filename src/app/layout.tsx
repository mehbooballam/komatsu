import type { Metadata } from "next";
import { COLLAPSED_SIDEBAR_WIDTH, DESKTOP_SIDEBAR_KEY } from "@/lib/sidebar-preferences";
import "./globals.css";

export const metadata: Metadata = {
  title: "Komatsu Regulatory Risk Dashboard",
  description: "Import, review, prioritise and assign regulatory alerts",
};

// Apply saved appearance preferences before the dashboard layout paints.
const appearanceInit = `
  try {
    const root = document.documentElement;
    if (localStorage.getItem("theme") === "dark") root.setAttribute("data-theme", "dark");
    if (localStorage.getItem(${JSON.stringify(DESKTOP_SIDEBAR_KEY)}) === "true") {
      root.style.setProperty("--sidebar-current", ${JSON.stringify(COLLAPSED_SIDEBAR_WIDTH)});
    }
  } catch {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceInit }} />
      </head>
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)]">{children}</body>
    </html>
  );
}
