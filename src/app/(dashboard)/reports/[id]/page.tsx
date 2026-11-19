"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, PencilLine, Printer, Send, Undo2, Trash2, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Sparkles,
} from "lucide-react";
import { ConfirmDialog } from "@/components/alerts/confirm-dialog";
import { ReportBriefing, type SectionEditing } from "@/components/reports/report-briefing";
import { ReportEditor } from "@/components/reports/report-editor";
import { copySections, periodLabel, type ReportContent, type ReportRecord, type SectionKey } from "@/lib/reports";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";
const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-50";

type Busy = null | "publish" | "unpublish" | "refresh" | "delete" | "save" | "reset";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [report, setReport] = useState<ReportRecord | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Inline section editing: which section is open, and the working copy
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [draft, setDraft] = useState<ReportContent | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reports/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "This report doesn't exist or was deleted." : "Could not load the report.");
        return res.json();
      })
      .then((d) => {
        if (cancelled) return;
        setReport(d.report);
        setCanEdit(d.can_edit);
      })
      .catch((e) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    setReport(data.report);
    return data.report as ReportRecord;
  }, [id]);

  async function run(kind: Busy, body: Record<string, unknown>, ok?: string) {
    setBusy(kind);
    setMessage(null);
    try {
      await patch(body);
      if (ok) setMessage({ kind: "ok", text: ok });
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  function startEdit(key: SectionKey) {
    if (!report) return;
    setMessage(null);
    setDraft(report.content);
    setEditing(key);
  }

  async function saveSection() {
    if (!report || !draft || !editing) return;
    // Only this section changes; it is marked as edited so refreshes keep it.
    const merged = copySections(report.content, draft, [editing]);
    const content = { ...merged, edited: Array.from(new Set([...report.content.edited, editing])) };
    const saved = await run("save", { content, expected_updated_at: report.updated_at });
    if (saved) {
      setEditing(null);
      setDraft(null);
    }
  }

  async function remove() {
    setBusy("delete");
    const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/reports");
      return;
    }
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    setConfirmDelete(false);
    setMessage({ kind: "error", text: body.error || "Could not delete the report." });
  }

  /** Print in the light theme at A4 width, then restore the viewer's theme. */
  function printReport() {
    const root = document.documentElement;
    const theme = root.getAttribute("data-theme");
    if (theme === "dark") root.setAttribute("data-theme", "light");
    root.classList.add("report-printing");
    const restore = () => {
      if (theme) root.setAttribute("data-theme", theme);
      root.classList.remove("report-printing");
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    // Give the charts a moment to re-measure at page width before printing
    setTimeout(() => window.print(), 400);
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300"><ArrowLeft className="h-4 w-4" /> Monthly Reports</Link>
        <p role="alert" className="panel p-4 text-sm text-red-600">{loadError}</p>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        Preparing the report…
      </div>
    );
  }

  const isDraft = report.status === "draft";
  const editable = canEdit && isDraft;
  const generatedAt = report.snapshot_at ? new Date(report.snapshot_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;

  const sectionEditing: SectionEditing | null = editable
    ? {
        editing,
        edited: report.content.edited,
        onEdit: startEdit,
        onReset: (key) => void run("reset", { action: "reset_section", section: key }, "Section reset to the automatic version."),
        renderEditor: (key) => (
          <div className="space-y-4">
            {draft && <ReportEditor content={draft} onChange={setDraft} section={key} />}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
              <span className="mr-auto text-xs text-[var(--muted-foreground)]">Your version is kept when the report refreshes.</span>
              <button type="button" className={btn} onClick={() => { setEditing(null); setDraft(null); }} disabled={busy === "save"}>Cancel</button>
              <button type="button" className={primaryBtn} onClick={saveSection} disabled={busy === "save"}>
                {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Save section
              </button>
            </div>
          </div>
        ),
      }
    : null;

  return (
    <div className="space-y-5">
      {/* Toolbar (hidden when printing) */}
      <div className="space-y-3 print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Monthly Reports
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wider text-slate-500">{periodLabel(report.period)}</span>
              {isDraft ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                  <PencilLine className="h-3 w-3" /> Draft
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3" /> Published {report.published_at && new Date(report.published_at).toLocaleDateString()}
                  {report.published_by_name && ` by ${report.published_by_name}`}
                </span>
              )}
              {generatedAt && (
                <span className="inline-flex items-center gap-1 text-slate-500">
                  <Sparkles className="h-3 w-3" /> {isDraft ? "Updated automatically" : "Figures frozen"} · {generatedAt}
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{report.title}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <button className={btn} onClick={() => run("refresh", { action: "refresh_snapshot" }, "Report refreshed from the latest alert data.")} disabled={!!busy || !!editing} title="Regenerate from the latest alert data (your edited sections are kept)">
                <RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} /> Refresh
              </button>
            )}
            <button className={btn} onClick={printReport} title="Print, or choose “Save as PDF” as the printer" disabled={!!editing}>
              <Printer className="h-4 w-4" /> Print / PDF
            </button>
            {editable && (
              <>
                <button className={btn} onClick={() => setConfirmDelete(true)} disabled={!!busy} aria-label="Delete draft" title="Delete draft">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  className={primaryBtn}
                  onClick={() => run("publish", { action: "publish" }, "Report published. Its figures and text are now frozen.")}
                  disabled={!!busy || !!editing}
                >
                  {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish
                </button>
              </>
            )}
            {canEdit && !isDraft && (
              <button className={btn} onClick={() => run("unpublish", { action: "unpublish" }, "Moved back to draft. It will update automatically again.")} disabled={!!busy}>
                {busy === "unpublish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Back to draft
              </button>
            )}
          </div>
        </div>

        {editable && !editing && (
          <p className="text-xs text-[var(--muted-foreground)]">
            Written automatically from the alert register. Use the <PencilLine className="inline h-3 w-3" /> on any section to change it.
          </p>
        )}

        {message && (
          <div
            role={message.kind === "error" ? "alert" : "status"}
            className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${message.kind === "error" ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"}`}
          >
            {message.kind === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            {message.text}
          </div>
        )}
      </div>

      <div className={busy === "refresh" || busy === "reset" ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
        <ReportBriefing
          title={report.title}
          period={report.period}
          content={report.content}
          snapshot={report.snapshot}
          history={report.history}
          status={report.status}
          editing={sectionEditing}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this draft?"
        description={`The ${periodLabel(report.period)} report will be removed. This can't be undone.`}
        confirmLabel="Delete draft"
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
