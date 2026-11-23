"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Described, Part } from "@/lib/audit-describe";

/** Renders a sentence with names in bold (and linked where possible). */
export function Sentence({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <React.Fragment key={i}>{p}</React.Fragment>
        ) : p.href ? (
          <Link key={i} href={p.href} className="font-semibold text-slate-900 hover:text-blue-600 hover:underline dark:text-white dark:hover:text-blue-300">
            {p.b}
          </Link>
        ) : (
          <strong key={i} className="font-semibold text-slate-900 dark:text-white">{p.b}</strong>
        )
      )}
    </>
  );
}

/** Before → after rows, readable at a glance. */
export function ChangeList({ changes }: { changes: Described["changes"] }) {
  if (!changes.length) return null;
  return (
    <dl className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
      {changes.map((c, i) => (
        <div key={i} className="grid grid-cols-1 gap-1 bg-slate-50/60 px-3 py-2 sm:grid-cols-[9rem_1fr] sm:gap-3 dark:bg-slate-900/40">
          <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{c.label}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {c.before !== undefined && (
              <span className="break-words rounded bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-300 dark:bg-red-500/10 dark:text-red-300">
                {c.before}
              </span>
            )}
            {c.before !== undefined && c.after !== undefined && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="changed to" />}
            {c.after !== undefined && (
              <span
                className={`break-words rounded px-1.5 py-0.5 ${
                  c.before !== undefined ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "text-slate-800 dark:text-slate-200"
                }`}
              >
                {c.after}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "Deleted group X" → "deleted group X" so it reads after the person's name. */
export function lowerFirst(parts: Part[]): Part[] {
  if (!parts.length || typeof parts[0] !== "string") return parts;
  const [first, ...rest] = parts;
  return [first.charAt(0).toLowerCase() + first.slice(1), ...rest];
}
