/* eslint-disable @next/next/no-img-element -- small inline data-URL images; next/image adds nothing here */
"use client";

import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Profile photo, falling back to coloured initials. */
export function UserAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  if (src) {
    return <img src={src} alt="" className={cn("h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-black/5", className)} />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-sky-500 text-[11px] font-semibold text-white",
        className
      )}
    >
      {initialsOf(name || "?")}
    </span>
  );
}

/** Square workspace icon, falling back to the default shield mark. */
export function WorkspaceIcon({ src, name, className }: { src?: string | null; name?: string; className?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ? `${name} icon` : ""}
        className={cn("h-9 w-9 shrink-0 rounded-xl bg-white object-contain ring-1 ring-black/5", className)}
      />
    );
  }
  return (
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 shadow-lg shadow-blue-900/30", className)}>
      <ShieldCheck className="h-1/2 w-1/2 text-white" />
    </span>
  );
}

/** Wide workspace logo; shows the dark-background variant in dark mode when one is set. */
export function WorkspaceLogo({
  logo,
  logoDark,
  name,
  className,
}: {
  logo?: string | null;
  logoDark?: string | null;
  name: string;
  className?: string;
}) {
  if (!logo && !logoDark) return null;
  const light = logo || logoDark!;
  const dark = logoDark || logo!;
  return (
    <>
      <img src={light} alt={name} className={cn("h-5 w-auto max-w-full object-contain object-left dark:hidden", className)} />
      <img src={dark} alt={name} className={cn("hidden h-5 w-auto max-w-full object-contain object-left dark:block", className)} />
    </>
  );
}
