"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Loader2, ChevronRight, CheckCircle2, PencilLine } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { periodLabel, RAG_LABELS, type ReportSummary } from "@/lib/reports";

const RAG_DOT = { green: "bg-emerald-600", amber: "bg-amber-400", red: "bg-red-600" } as const;

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [month, setMonth] = useState(thisMonth());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports")
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? "You don't have access to monthly reports." : "Could not load reports.");
        return res.json();
      })
      .then((d) => {
        if (cancelled) return;
        setReports(d.reports);
        setCanEdit(d.can_edit);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const existing = new Set((reports || []).map((r) => r.period.slice(0, 7)));

  function openCreate() {
    // Suggest the first month from now (or the current one) that has no report yet
    let m = thisMonth();
    for (let i = 0; i < 24 && existing.has(m); i++) {
      const [y, mm] = m.split("-").map(Number);
      const d = new Date(y, mm, 1);
      m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    setMonth(m);
    setFormError(null);
    setCreating(true);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (existing.has(month)) {
      setFormError("There's already a report for that month.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: month }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not create the report.");
      router.push(`/reports/${body.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the report.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Monthly Reports</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Written automatically from the alert register each month. Edit any section before publishing.</p>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Other month
          </button>
        )}
      </div>

      {error && <p role="alert" className="panel p-4 text-sm text-red-600">{error}</p>}

      {!reports && !error && (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      )}

      {reports && reports.length === 0 && (
        <div className="panel flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
            <FileText className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">No reports yet</h2>
          <p className="mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
            Reports are generated automatically each month by an administrator or manager. Ask one of them to open this page.
          </p>
          {canEdit && (
            <button onClick={openCreate} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> Generate a report
            </button>
          )}
        </div>
      )}

      {reports && reports.length > 0 && (
        <ul className="panel divide-y divide-[var(--border)] overflow-hidden">
          {reports.map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${r.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div className="w-24 shrink-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{periodLabel(r.period).split(" ")[0]}</div>
                  <div className="text-xs text-slate-500">{r.period.slice(0, 4)}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.title}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {r.status === "published"
                      ? `Published ${when(r.published_at)}${r.published_by_name ? ` by ${r.published_by_name}` : ""}`
                      : `Last edited ${when(r.updated_at)}${r.updated_by_name ? ` by ${r.updated_by_name}` : ""}`}
                  </div>
                </div>
                {r.rag && (
                  <span className="hidden items-center gap-1.5 text-xs font-semibold text-slate-600 sm:inline-flex dark:text-slate-300">
                    <span className={`h-2.5 w-2.5 rounded-full ${RAG_DOT[r.rag]}`} /> {RAG_LABELS[r.rag]}
                  </span>
                )}
                {r.status === "published" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                    <CheckCircle2 className="h-3 w-3" /> Published
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                    <PencilLine className="h-3 w-3" /> Draft
                  </span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={(o) => !saving && setCreating(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate a report</DialogTitle>
            <DialogDescription>This month&apos;s report is created automatically. Choose another month to generate it from the alert register.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Month</span>
              <input type="month" required className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} />
              {existing.has(month) && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">A report for this month already exists.</span>}
            </label>
            {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="submit" disabled={saving || existing.has(month)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Generate
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
