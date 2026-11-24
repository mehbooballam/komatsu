"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { ImportPreview } from "@/components/imports/import-preview";

interface ImportBatch {
  id: string;
  filename: string;
  format: string;
  status: string;
  rowCounts: Record<string, number>;
  createdAt: string;
}

interface Notice {
  kind: "success" | "warning" | "error";
  title: string;
  detail?: string;
  stats?: Array<{ label: string; value: number }>;
  errors?: string[];
  showAlertsLink?: boolean;
  products?: { linked: number; alerts_matched: number; unmatched: Array<{ label: string; alerts: number }> };
  /** From the Needs Human Review column */
  humanReview?: { flagged: number; cleared: number };
}

const NOTICE_STYLES: Record<Notice["kind"], string> = {
  success: "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300",
  error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300",
};

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div role={notice.kind === "error" ? "alert" : "status"} className={`mb-6 rounded-xl border p-4 ${NOTICE_STYLES[notice.kind]}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{notice.title}</p>
          {notice.detail && <p className="mt-1 text-sm opacity-90 break-words">{notice.detail}</p>}
          {notice.stats && (
            <div className="mt-3 flex flex-wrap gap-2">
              {notice.stats.map((s) => (
                <span key={s.label} className="inline-flex items-baseline gap-1.5 rounded-lg bg-white/70 dark:bg-slate-900/40 px-3 py-1.5 text-xs">
                  <span className="text-base font-semibold tabular-nums">{s.value}</span>
                  <span className="opacity-80">{s.label}</span>
                </span>
              ))}
            </div>
          )}
          {notice.errors && notice.errors.length > 0 && (
            <ul className="mt-3 space-y-0.5 text-xs opacity-90">
              {notice.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {notice.errors.length > 5 && <li>… and {notice.errors.length - 5} more</li>}
            </ul>
          )}
          {notice.humanReview && (notice.humanReview.flagged > 0 || notice.humanReview.cleared > 0) && (
            <div className="mt-3 rounded-lg bg-white/70 px-3 py-2.5 text-xs dark:bg-slate-900/40">
              <p className="font-semibold">Needs human review</p>
              {notice.humanReview.flagged > 0 && (
                <p className="mt-0.5 opacity-90">
                  {notice.humanReview.flagged} alert{notice.humanReview.flagged === 1 ? " was" : "s were"} marked <strong>Needs review</strong> by the file.{" "}
                  <Link href="/alerts?human_review=true" className="font-medium underline underline-offset-2 hover:opacity-80">
                    Review them →
                  </Link>
                </p>
              )}
              {notice.humanReview.cleared > 0 && (
                <p className="mt-0.5 opacity-90">
                  {notice.humanReview.cleared} alert{notice.humanReview.cleared === 1 ? " no longer needs" : "s no longer need"} review (the file now says No).
                </p>
              )}
            </div>
          )}
          {notice.products && (notice.products.alerts_matched > 0 || notice.products.unmatched.length > 0) && (
            <div className="mt-3 rounded-lg bg-white/70 px-3 py-2.5 text-xs dark:bg-slate-900/40">
              <p className="font-semibold">Products</p>
              {notice.products.alerts_matched > 0 && (
                <p className="mt-0.5 opacity-90">
                  {notice.products.alerts_matched} alert{notice.products.alerts_matched === 1 ? "" : "s"} matched to your products
                  (added as suggestions to confirm).
                </p>
              )}
              {notice.products.unmatched.length > 0 && (
                <>
                  <p className="mt-1 opacity-90">
                    Not in Products — left untagged so you can create them or tag the alerts yourself:
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {notice.products.unmatched.slice(0, 12).map((u) => (
                      <li key={u.label} className="rounded-full border border-dashed border-current/30 px-2 py-0.5">
                        {u.label} <span className="opacity-60">· {u.alerts}</span>
                      </li>
                    ))}
                    {notice.products.unmatched.length > 12 && <li className="px-1 py-0.5 opacity-70">+{notice.products.unmatched.length - 12} more</li>}
                  </ul>
                  <Link href="/products" className="mt-2 inline-block font-medium underline underline-offset-2 hover:opacity-80">
                    Open Products →
                  </Link>
                </>
              )}
            </div>
          )}
          {notice.showAlertsLink && (
            <Link href="/alerts" className="mt-3 inline-block text-sm font-medium underline underline-offset-2 hover:opacity-80">
              View alerts →
            </Link>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="rounded p-1 opacity-60 hover:opacity-100">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function ImportsPage() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Batch open in the preview (just uploaded, or reopened from the history)
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/imports");
      if (res.ok) {
        const data = await res.json();
        setBatches(data.imports || []);
      }
    } catch (error) {
      console.error("Could not refresh import history:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/imports")
      .then((res) => (res.ok ? res.json() : { imports: [] }))
      .catch(() => ({ imports: [] }))
      .then((data) => {
        if (cancelled) return;
        setBatches(data.imports || []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpload(file: File) {
    if (!file) return;
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "xlsx" && ext !== "csv") {
      setNotice({ kind: "error", title: "Unsupported file", detail: "Please upload an .xlsx or .csv file." });
      return;
    }
    setNotice(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/imports/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", title: data.error || "Upload failed", detail: data.details });
        return;
      }
      setPreviewId(data.batchId);
      loadBatches();
    } catch {
      setNotice({ kind: "error", title: "Upload failed", detail: "Check your connection and try again." });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function showResult(data: { counts?: Record<string, unknown> }) {
    const c = (data.counts || {}) as {
      created?: number; updated?: number; unchanged?: number; skipped?: number; replaced?: number; ignored?: number;
      errors?: Array<{ rowNumber: number; message: string }>;
      products?: Notice["products"]; human_review?: Notice["humanReview"];
    };
    const rowErrors = c.errors || [];
    setNotice({
      kind: rowErrors.length ? "warning" : "success",
      title: "Import complete",
      stats: [
        { label: "Created", value: c.created ?? 0 },
        { label: "Updated", value: c.updated ?? 0 },
        { label: "Unchanged", value: c.unchanged ?? 0 },
        ...(c.replaced ? [{ label: "Replaced", value: c.replaced }] : []),
        ...(c.ignored ? [{ label: "Ignored", value: c.ignored }] : []),
        { label: "Skipped", value: c.skipped ?? 0 },
      ],
      errors: rowErrors.map((e) => (e.rowNumber ? `Row ${e.rowNumber}: ${e.message}` : e.message)),
      showAlertsLink: (c.created ?? 0) + (c.updated ?? 0) + (c.replaced ?? 0) > 0,
      products: c.products,
      humanReview: c.human_review,
    });
    setPreviewId(null);
    loadBatches();
  }

  async function cancelBatch(b: ImportBatch) {
    if (!window.confirm(`Cancel the import of “${b.filename}”? The uploaded file is removed; nothing has been imported from it.`)) return;
    setCancelling(b.id);
    try {
      const res = await fetch(`/api/imports/${b.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      setNotice(res.ok ? { kind: "success", title: `Cancelled the import of ${b.filename}` } : { kind: "error", title: body.error || "Could not cancel the import" });
    } finally {
      setCancelling(null);
      loadBatches();
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }

  const statusColors: Record<string, string> = {
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    previewing: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Imports</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Upload and manage Daptic alert files</p>
        </div>
        <div className="flex gap-2">
          {/* Plain download links: these fetch files from API routes */}
          <a href="/api/imports/template?format=xlsx" download className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
            Download Excel template
          </a>
          <a href="/api/imports/template?format=csv" download className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
            Download CSV template
          </a>
        </div>
      </div>

      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

      {/* Upload area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-8
          ${dragOver ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-slate-300 dark:border-slate-600 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
      >
        <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }} />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Uploading and parsing...</p>
          </div>
        ) : (
          <>
            <svg className="w-10 h-10 mx-auto text-slate-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Drop an Excel or CSV file here, or click to browse</p>
            <p className="text-xs text-slate-400 mt-1">Accepts .xlsx and .csv files</p>
          </>
        )}
      </div>

      {/* Preview: column mapping, rows and issues */}
      {previewId && (
        <ImportPreview
          batchId={previewId}
          onClose={() => {
            setPreviewId(null);
            loadBatches();
          }}
          onCancelled={(name) => {
            setPreviewId(null);
            setNotice({ kind: "success", title: `Cancelled the import of ${name}` });
            loadBatches();
          }}
          onImported={showResult}
        />
      )}

      {/* Import history */}
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Import history</h2>
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />)}</div>
      ) : batches.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          <p>No imports yet. Upload an Excel or CSV file to get started.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3">File</th>
                <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Format</th>
                <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3">Status</th>
                <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Rows</th>
                <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Date</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white truncate max-w-[200px]">{b.filename}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 uppercase hidden sm:table-cell">{b.format}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[b.status] || "bg-slate-100 text-slate-600"}`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden md:table-cell">
                    {b.rowCounts?.total ??
                      ((b.rowCounts?.created ?? 0) + (b.rowCounts?.updated ?? 0) + (b.rowCounts?.unchanged ?? 0) + (b.rowCounts?.skipped ?? 0) || "—")}
                    {b.rowCounts?.created ? <span className="text-green-600 ml-1">(+{b.rowCounts.created})</span> : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                    {new Date(b.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {b.status === "previewing" && (
                        <button
                          onClick={() => setPreviewId(b.id)}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Review &amp; import
                        </button>
                      )}
                      {["previewing", "failed", "validating", "uploading"].includes(b.status) && (
                        <button
                          onClick={() => cancelBatch(b)}
                          disabled={cancelling === b.id}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-red-500/10"
                        >
                          {cancelling === b.id ? "Cancelling…" : b.status === "failed" ? "Remove" : "Cancel import"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
