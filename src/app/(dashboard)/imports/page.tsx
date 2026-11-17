"use client";

import { useEffect, useState, useRef, useCallback } from "react";

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

export default function ImportsPage() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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
      alert("Please upload an .xlsx or .csv file");
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/imports/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Upload failed"); return; }
      const previewRes = await fetch(`/api/imports/${data.batch_id}/preview`);
      const previewData = await previewRes.json();
      setPreview(previewData);
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setConfirming(true);
    try {
      await fetch(`/api/imports/${preview.batch_id}/confirm`, { method: "POST" });
      setPreview(null);
      loadBatches();
    } catch {
      alert("Import failed");
    } finally {
      setConfirming(false);
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
                    {b.row_counts.total || "—"}
                    {b.row_counts.created ? <span className="text-green-600 ml-1">(+{b.row_counts.created})</span> : null}
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
