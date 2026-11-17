"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

interface ImportBatch {
  id: string;
  original_filename: string;
  input_format: string;
  status: string;
  row_counts: Record<string, number>;
  created_at: string;
  completed_at: string | null;
  uploader_name?: string;
}

interface PreviewData {
  batch_id: string;
  columns: string[];
  sample_rows: Record<string, unknown>[];
  counts: { total: number; new: number; changed: number; unchanged: number; invalid: number };
  errors: Array<{ row: number; field: string; message: string }>;
}

interface PreviewApiRow {
  rowNumber: number;
  state: string;
  alertStatus: "new" | "existing";
  errors: Array<{ field: string; message: string }>;
  raw: Record<string, unknown> | null;
}

interface PreviewApiResponse {
  batch: { id: string };
  counts: { total?: number; invalid?: number };
  rows: PreviewApiRow[];
}

// Adapts GET /api/imports/[id]/preview to the shape the preview modal renders.
function toPreviewData(data: PreviewApiResponse): PreviewData {
  const rows = data.rows || [];
  const valid = rows.filter((r) => r.state === "valid");
  return {
    batch_id: data.batch.id,
    columns: rows[0]?.raw ? Object.keys(rows[0].raw) : [],
    sample_rows: rows.map((r) => r.raw || {}),
    counts: {
      total: data.counts?.total ?? rows.length,
      new: valid.filter((r) => r.alertStatus === "new").length,
      changed: valid.filter((r) => r.alertStatus === "existing").length,
      unchanged: 0,
      invalid: rows.filter((r) => r.state === "invalid").length,
    },
    errors: rows.flatMap((r) => (r.errors || []).map((e) => ({ row: r.rowNumber, field: e.field, message: e.message }))),
  };
}

interface Notice {
  kind: "success" | "warning" | "error";
  title: string;
  detail?: string;
  stats?: Array<{ label: string; value: number }>;
  errors?: string[];
  showAlertsLink?: boolean;
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
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(async () => {
    const res = await fetch("/api/imports");
    const data = await res.json();
    setBatches(data.batches || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

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
      const previewRes = await fetch(`/api/imports/${data.batchId}/preview`);
      const previewJson = await previewRes.json();
      if (!previewRes.ok) {
        setNotice({ kind: "error", title: previewJson.error || "Could not load preview" });
        return;
      }
      setPreview(toPreviewData(previewJson));
      loadBatches();
    } catch {
      setNotice({ kind: "error", title: "Upload failed", detail: "Check your connection and try again." });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/imports/${preview.batch_id}/confirm`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", title: data.error || "Import failed", detail: data.details });
        setPreview(null);
        return;
      }
      const c = data.counts || {};
      const rowErrors: Array<{ rowNumber: number; message: string }> = c.errors || [];
      setNotice({
        kind: rowErrors.length ? "warning" : "success",
        title: "Import complete",
        stats: [
          { label: "Created", value: c.created ?? 0 },
          { label: "Updated", value: c.updated ?? 0 },
          { label: "Unchanged", value: c.unchanged ?? 0 },
          { label: "Skipped", value: c.skipped ?? 0 },
        ],
        errors: rowErrors.map((e) => (e.rowNumber ? `Row ${e.rowNumber}: ${e.message}` : e.message)),
        showAlertsLink: (c.created ?? 0) + (c.updated ?? 0) > 0,
      });
      setPreview(null);
    } catch {
      setNotice({ kind: "error", title: "Import failed", detail: "Check your connection and try again." });
    } finally {
      setConfirming(false);
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
          <a href="/api/imports/template?format=xlsx" className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
            Download Excel template
          </a>
          <a href="/api/imports/template?format=csv" className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
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

      {/* Preview dialog */}
      {preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Import preview</h2>
              <div className="flex gap-4 mt-3 text-sm">
                <span className="text-green-600 dark:text-green-400">New: {preview.counts.new}</span>
                <span className="text-blue-600 dark:text-blue-400">Changed: {preview.counts.changed}</span>
                <span className="text-slate-500">Unchanged: {preview.counts.unchanged}</span>
                <span className="text-red-600 dark:text-red-400">Invalid: {preview.counts.invalid}</span>
                <span className="font-medium text-slate-900 dark:text-white">Total: {preview.counts.total}</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {preview.errors.length > 0 && (
                <div className="mb-4 bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">Validation issues</h3>
                  <ul className="text-xs space-y-1 text-red-600 dark:text-red-300">
                    {preview.errors.slice(0, 10).map((err, i) => (
                      <li key={i}>Row {err.row}: {err.field} — {err.message}</li>
                    ))}
                    {preview.errors.length > 10 && <li>... and {preview.errors.length - 10} more</li>}
                  </ul>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      {preview.columns.slice(0, 8).map((col) => (
                        <th key={col} className="text-left px-2 py-1.5 font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                        {preview.columns.slice(0, 8).map((col) => (
                          <td key={col} className="px-2 py-1.5 text-slate-700 dark:text-slate-300 max-w-[200px] truncate">{String(row[col] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex gap-3 justify-end">
              <button onClick={() => setPreview(null)} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
              <button onClick={handleConfirm} disabled={confirming}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg">
                {confirming ? "Importing..." : `Import ${preview.counts.new + preview.counts.changed} alerts`}
              </button>
            </div>
          </div>
        </div>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white truncate max-w-[200px]">{b.original_filename}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 uppercase hidden sm:table-cell">{b.input_format}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[b.status] || "bg-slate-100 text-slate-600"}`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden md:table-cell">
                    {b.row_counts?.total ??
                      ((b.row_counts?.created ?? 0) + (b.row_counts?.updated ?? 0) + (b.row_counts?.unchanged ?? 0) + (b.row_counts?.skipped ?? 0) || "—")}
                    {b.row_counts?.created ?<span className="text-green-600 ml-1">(+{b.row_counts.created})</span> : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                    {new Date(b.created_at).toLocaleDateString()}
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
