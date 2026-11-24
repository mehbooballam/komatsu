"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X, Loader2, Columns3, Rows3, AlertTriangle, CheckCircle2, Sparkles, Save, RotateCcw, Trash2, Database, ChevronDown, Search, BookmarkCheck, CopyCheck,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ImportMatches, type DecisionInput, type MatchesResponse } from "./import-matches";

/* ---------- Types (GET /api/imports/[id]/preview) ---------- */

interface Target {
  name: string;
  label: string;
  type: string;
  required: boolean;
  description: string;
  stored: string;
  legacy: boolean;
  disabled: boolean;
}

interface MappingColumn {
  header: string;
  target: string | null;
  auto: string | null;
  has_data: boolean;
  filled: number;
  samples: string[];
  note: string | null;
}

interface PreviewRow {
  rowNumber: number;
  alertId: string | null;
  state: string;
  alertStatus: "new" | "existing";
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
  raw: Record<string, string | null> | null;
}

interface PreviewResponse {
  mapping: { columns: MappingColumn[]; targets: Target[]; problems: string[]; profile: { id: string; name: string } | null };
  batch: { id: string; filename: string; format: string; status: string };
  counts: { total?: number; valid?: number; invalid?: number; duplicates?: number };
  rows: PreviewRow[];
}

interface SavedMapping {
  id: string;
  name: string;
  headers: string[];
  mapping: Record<string, string | null>;
  updated_at: string;
  last_used_at: string | null;
  updated_by_name: string | null;
}

type Tab = "mapping" | "matches" | "rows" | "issues";
type MappingFilter = "all" | "mapped" | "skipped" | "changed";

const ROW_LIMIT = 100;
const norm = (h: string) => h.toLowerCase().trim().replace(/\s+/g, " ");

/* ---------- Field picker ---------- */

function FieldPicker({
  value, targets, usedBy, onChange, header,
}: {
  value: string | null;
  targets: Target[];
  usedBy: Map<string, string>;
  onChange: (v: string | null) => void;
  header: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = targets.find((t) => t.name === value);
  const list = targets.filter((t) => !q || `${t.label} ${t.name}`.toLowerCase().includes(q.toLowerCase()));
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Field for ${header}`}
          className={`flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border px-2.5 text-left text-sm transition-colors ${
            current
              ? "border-slate-200 bg-white text-slate-900 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              : "border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-blue-300 dark:border-slate-600 dark:bg-slate-800/60"
          }`}
        >
          <span className="truncate">{current ? current.label : "Don't import"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search fields…"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => pick(null)}
            className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Don&apos;t import this column
          </button>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          {list.map((t) => {
            const other = usedBy.get(t.name);
            const taken = other && other !== header;
            return (
              <button
                key={t.name}
                type="button"
                disabled={t.disabled}
                onClick={() => pick(t.name)}
                title={t.disabled ? "Not imported for now" : taken ? `Currently mapped from “${other}” — choosing it here un-maps that column` : t.description}
                className={`flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800 ${t.name === value ? "bg-blue-50 dark:bg-blue-500/10" : ""}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{t.label}</span>
                  {t.required && <span className="rounded bg-red-50 px-1 text-[10px] font-semibold text-red-600 dark:bg-red-500/10 dark:text-red-300">required</span>}
                  {t.legacy && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-800">older layout</span>}
                  {t.disabled && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-800">not imported</span>}
                </span>
                <span className="text-[11px] text-slate-500">
                  {t.name}
                  {taken && <span className="text-amber-600 dark:text-amber-400"> · used by “{other}”</span>}
                </span>
              </button>
            );
          })}
          {list.length === 0 && <p className="px-2.5 py-3 text-sm text-slate-500">No field matches.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ---------- Main ---------- */

export function ImportPreview({
  batchId,
  onClose,
  onCancelled,
  onImported,
}: {
  batchId: string;
  onClose: () => void;
  onCancelled: (filename: string) => void;
  onImported: (result: Record<string, unknown>) => void;
}) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [tab, setTab] = useState<Tab>("mapping");
  const [filter, setFilter] = useState<MappingFilter>("all");
  const [busy, setBusy] = useState<null | "apply" | "save" | "import" | "cancel">(null);
  const [saved, setSaved] = useState<SavedMapping[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Rows that match other alerts by content, and what to do with them
  const [matches, setMatches] = useState<MatchesResponse | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/imports/${batchId}/preview`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Could not load the preview");
      return;
    }
    setData(json);
    setDraft(Object.fromEntries((json as PreviewResponse).mapping.columns.map((c) => [c.header, c.target])));
  }, [batchId]);

  const loadMatches = useCallback(async () => {
    const res = await fetch(`/api/imports/${batchId}/matches`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) setMatches(json);
    else setFlash({ ok: false, text: json.error || "Could not compare the rows with your alerts" });
  }, [batchId]);

  const loadSaved = useCallback(async () => {
    const res = await fetch("/api/imports/mappings");
    if (res.ok) setSaved((await res.json()).mappings || []);
  }, []);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
    void loadSaved();
    void loadMatches();
  }, [load, loadSaved, loadMatches]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const columns = useMemo(() => data?.mapping.columns ?? [], [data]);
  const targets = useMemo(() => data?.mapping.targets ?? [], [data]);
  const targetBy = useMemo(() => new Map(targets.map((t) => [t.name, t])), [targets]);
  const dirty = columns.some((c) => (draft[c.header] ?? null) !== c.target);

  // Which header uses each field in the draft
  const usedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of columns) {
      const t = draft[c.header];
      if (t && !m.has(t)) m.set(t, c.header);
    }
    return m;
  }, [columns, draft]);

  // Problems in the draft (same rules as the server)
  const draftProblems = useMemo(() => {
    const out: string[] = [];
    const seen = new Map<string, string>();
    for (const c of columns) {
      const t = draft[c.header];
      if (!t) continue;
      const other = seen.get(t);
      if (other) out.push(`“${other}” and “${c.header}” are both mapped to ${targetBy.get(t)?.label ?? t}.`);
      else seen.set(t, c.header);
    }
    for (const t of targets.filter((x) => x.required)) if (!seen.has(t.name)) out.push(`Map a column to ${t.label} — it is required.`);
    return out;
  }, [columns, draft, targets, targetBy]);

  const setField = (header: string, value: string | null) =>
    setDraft((d) => {
      const next = { ...d };
      // A field is used by one column: un-map whichever column had it
      if (value) for (const h of Object.keys(next)) if (h !== header && next[h] === value) next[h] = null;
      next[header] = value;
      return next;
    });

  async function putMapping(mapping: Record<string, string | null>, profileId?: string | null) {
    const res = await fetch(`/api/imports/${batchId}/mapping`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileId !== undefined ? { mapping, profile_id: profileId } : { mapping }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not apply the mapping");
    await Promise.all([load(), loadMatches()]);
  }

  /** Saves match decisions or the match percentage; the server answers with the updated matches. */
  async function putMatches(body: { decisions?: DecisionInput[]; threshold?: number }) {
    setMatchBusy(true);
    try {
      const res = await fetch(`/api/imports/${batchId}/matches`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setMatches(json);
      else {
        setFlash({ ok: false, text: json.error || "Could not save the decision" });
        await loadMatches();
      }
    } catch {
      setFlash({ ok: false, text: "Could not save the decision. Check your connection and try again." });
    } finally {
      setMatchBusy(false);
    }
  }

  async function apply() {
    setBusy("apply");
    try {
      await putMapping(draft);
      setFlash({ ok: true, text: "Mapping applied — rows checked again" });
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : "Could not apply the mapping" });
    } finally {
      setBusy(null);
    }
  }

  function resetToAuto() {
    setDraft(Object.fromEntries(columns.map((c) => [c.header, c.auto])));
  }

  async function applySaved(p: SavedMapping) {
    const byNorm = new Map(Object.entries(p.mapping).map(([h, t]) => [norm(h), t]));
    const next: Record<string, string | null> = {};
    const used = new Set<string>();
    for (const c of columns) {
      if (!byNorm.has(norm(c.header))) continue;
      const t = byNorm.get(norm(c.header)) ?? null;
      next[c.header] = t && targetBy.has(t) && !targetBy.get(t)!.disabled && !used.has(t) ? t : null;
      if (next[c.header]) used.add(next[c.header]!);
    }
    for (const c of columns) {
      if (c.header in next) continue;
      next[c.header] = c.auto && !used.has(c.auto) ? c.auto : null;
      if (next[c.header]) used.add(next[c.header]!);
    }
    setBusy("apply");
    try {
      await putMapping(next, p.id);
      setFlash({ ok: true, text: `Applied the saved mapping “${p.name}”` });
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : "Could not apply the mapping" });
    } finally {
      setBusy(null);
    }
  }

  async function saveMapping() {
    const name = saveName.trim();
    if (!name) return;
    setBusy("save");
    try {
      if (dirty) await putMapping(draft);
      const res = await fetch("/api/imports/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId, name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save the mapping");
      setSaveOpen(false);
      setSaveName("");
      await Promise.all([load(), loadSaved()]);
      setFlash({ ok: true, text: json.replaced ? `Updated the saved mapping “${name}”` : `Saved “${name}” — files with these columns will use it automatically` });
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : "Could not save the mapping" });
    } finally {
      setBusy(null);
    }
  }

  async function deleteSaved(p: SavedMapping) {
    const res = await fetch(`/api/imports/mappings/${p.id}`, { method: "DELETE" });
    setFlash(res.ok ? { ok: true, text: `Deleted the saved mapping “${p.name}”` } : { ok: false, text: "Could not delete the mapping" });
    await Promise.all([loadSaved(), load()]);
  }

  async function runImport() {
    setBusy("import");
    try {
      if (dirty) await putMapping(draft);
      const res = await fetch(`/api/imports/${batchId}/confirm`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash({ ok: false, text: json.problems?.[0] || json.error || "Import failed" });
        await Promise.all([load(), loadMatches()]);
        if (json.undecided || json.conflicts) setTab("matches");
        return;
      }
      onImported(json);
    } catch {
      setFlash({ ok: false, text: "Import failed — check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function cancelImport() {
    setBusy("cancel");
    const res = await fetch(`/api/imports/${batchId}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) onCancelled(data?.batch.filename || "the file");
    else setFlash({ ok: false, text: (await res.json().catch(() => ({}))).error || "Could not cancel the import" });
  }

  /* ---------- Derived for display ---------- */

  const rows = data?.rows ?? [];
  const validRows = rows.filter((r) => r.state === "valid");
  const counts = {
    total: rows.length,
    new: validRows.filter((r) => r.alertStatus === "new").length,
    update: validRows.filter((r) => r.alertStatus === "existing").length,
    invalid: rows.filter((r) => r.state === "invalid").length,
  };
  const issues = rows.flatMap((r) => [
    ...(r.errors || []).map((e) => ({ row: r.rowNumber, field: e.field, message: e.message, error: true })),
    ...(r.warnings || []).map((e) => ({ row: r.rowNumber, field: e.field, message: e.message, error: false })),
  ]);
  const mappedCount = columns.filter((c) => draft[c.header]).length;
  const changedFromAuto = columns.filter((c) => (draft[c.header] ?? null) !== c.auto).length;
  const problems = dirty ? draftProblems : data?.mapping.problems ?? [];
  const missingData = columns.filter((c) => !c.has_data).length;
  const shownColumns = columns.filter((c) => {
    const t = draft[c.header] ?? null;
    if (filter === "mapped") return !!t;
    if (filter === "skipped") return !t;
    if (filter === "changed") return t !== c.auto;
    return true;
  });
  const canImport = !dirty ? problems.length === 0 && counts.new + counts.update > 0 : draftProblems.length === 0;
  const toDecide = (matches?.undecided ?? 0) + (matches?.conflicts ?? 0);
  const contentMatches = matches?.rows.filter((r) => r.kind === "content").length ?? 0;
  const toImport = matches ? matches.totals.create + matches.totals.update : counts.new + counts.update;
  const profile = data?.mapping.profile ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Import preview">
      <div className="flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        {/* Header */}
        <div className="border-b border-slate-200 px-4 py-4 sm:px-6 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Import preview</h2>
              <p className="mt-0.5 truncate text-sm text-slate-500" title={data?.batch.filename}>{data?.batch.filename ?? "Loading…"}</p>
            </div>
            <button onClick={onClose} disabled={!!busy} aria-label="Close preview" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
              <X className="h-5 w-5" />
            </button>
          </div>
          {data && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">New {matches ? matches.totals.create - matches.undecided : counts.new}</span>
              <span className="rounded-lg bg-blue-50 px-2.5 py-1 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">Update {matches ? matches.totals.update : counts.update}</span>
              {!!matches?.totals.unchanged && <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">Unchanged {matches.totals.unchanged}</span>}
              {!!matches?.totals.skip && <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">Left out {matches.totals.skip}</span>}
              {contentMatches > 0 && (
                <button type="button" onClick={() => setTab("matches")} className="rounded-lg bg-amber-50 px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300">
                  {matches?.undecided ? `To decide ${matches.undecided}` : `Matches ${contentMatches}`}
                </button>
              )}
              <span className={`rounded-lg px-2.5 py-1 font-medium ${counts.invalid ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>Invalid {counts.invalid}</span>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">Rows {counts.total}</span>
              <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block dark:bg-slate-700" />
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                {profile ? <BookmarkCheck className="h-4 w-4 text-emerald-600" /> : <Sparkles className="h-4 w-4 text-blue-600" />}
                {profile ? <>Saved mapping <strong>{profile.name}</strong></> : "Mapped automatically"} · {mappedCount} of {columns.length} columns imported
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-3 sm:px-5 dark:border-slate-700" role="tablist">
          {([
            ["mapping", "Column mapping", Columns3, problems.length || null],
            ["matches", "Matches", CopyCheck, toDecide || null],
            ["rows", "Rows", Rows3, null],
            ["issues", "Issues", AlertTriangle, issues.length || null],
          ] as const).map(([key, label, Icon, badge]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium ${
                tab === key ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
              {badge != null && (
                <span className={`rounded-full px-1.5 text-xs ${key === "matches" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" : key === "mapping" ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {error && <p className="m-6 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
          {!data && !error && (
            <div className="space-y-2 p-6">{[...Array(6)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}</div>
          )}

          {data && tab === "mapping" && (
            <div className="p-4 sm:p-6">
              {problems.length > 0 && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <p className="font-semibold">Fix before importing</p>
                  <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
              {missingData > 0 && (
                <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  This file was uploaded before every column was kept, so {missingData} unmapped column{missingData === 1 ? " has" : "s have"} no values here. Cancel and upload it again to map {missingData === 1 ? "it" : "them"}.
                </p>
              )}

              {/* Toolbar */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs dark:border-slate-700">
                  {([
                    ["all", `All ${columns.length}`],
                    ["mapped", `Imported ${mappedCount}`],
                    ["skipped", `Not imported ${columns.length - mappedCount}`],
                    ["changed", `Changed ${changedFromAuto}`],
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setFilter(k)}
                      className={`rounded-md px-2.5 py-1 font-medium ${filter === k ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                        <BookmarkCheck className="h-4 w-4" /> Saved mappings{saved.length ? ` (${saved.length})` : ""} <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-1.5">
                      {saved.length === 0 && <p className="px-2.5 py-3 text-sm text-slate-500">No saved mappings yet. Save this one so files with the same columns are mapped the same way.</p>}
                      {saved.map((p) => (
                        <div key={p.id} className="flex items-center gap-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">
                          <button onClick={() => applySaved(p)} disabled={!!busy} className="min-w-0 flex-1 px-2.5 py-1.5 text-left">
                            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                              <span className="truncate">{p.name}</span>
                              {profile?.id === p.id && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                            </span>
                            <span className="block text-[11px] text-slate-500">
                              {p.headers.length} columns · {p.last_used_at ? `last used ${new Date(p.last_used_at).toLocaleDateString()}` : `saved ${new Date(p.updated_at).toLocaleDateString()}`}
                              {p.updated_by_name ? ` · ${p.updated_by_name}` : ""}
                            </span>
                          </button>
                          <button onClick={() => deleteSaved(p)} aria-label={`Delete saved mapping ${p.name}`} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </PopoverContent>
                  </Popover>
                  <button onClick={resetToAuto} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" title="Use the mapping suggested from the header names">
                    <RotateCcw className="h-4 w-4" /> Automatic
                  </button>
                  <Popover open={saveOpen} onOpenChange={(o) => { setSaveOpen(o); if (o && !saveName) setSaveName(profile?.name || (data.batch.filename || "").replace(/\.(xlsx|csv)$/i, "").replace(/\s*-?\s*week of .*$/i, "").trim() || "Daptic alerts"); }}>
                    <PopoverTrigger asChild>
                      <button disabled={!!busy || draftProblems.length > 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                        <Save className="h-4 w-4" /> Save mapping
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-3">
                      <form onSubmit={(e) => { e.preventDefault(); void saveMapping(); }}>
                        <label className="text-xs font-semibold text-slate-500" htmlFor="mapping-name">Name</label>
                        <input
                          id="mapping-name"
                          autoFocus
                          value={saveName}
                          onChange={(e) => setSaveName(e.target.value.slice(0, 80))}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                        />
                        <p className="mt-2 text-xs text-slate-500">Files with the same columns will use this mapping automatically. Saving again for this layout updates it.</p>
                        <div className="mt-3 flex justify-end">
                          <button type="submit" disabled={!saveName.trim() || busy === "save"} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                            {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
                          </button>
                        </div>
                      </form>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Mapping table */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="w-[22%] px-3 py-2">File column</th>
                      <th className="w-[30%] px-3 py-2">Sample values</th>
                      <th className="w-[20%] px-3 py-2">Imported as</th>
                      <th className="px-3 py-2"><span className="inline-flex items-center gap-1"><Database className="h-3 w-3" /> Stored in</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {shownColumns.map((c) => {
                      const t = draft[c.header] ?? null;
                      const target = t ? targetBy.get(t) : undefined;
                      const changed = t !== c.target;
                      const fromAuto = t === c.auto;
                      return (
                        <tr key={c.header} className={changed ? "bg-blue-50/50 dark:bg-blue-500/5" : !t ? "bg-slate-50/60 dark:bg-slate-800/20" : ""}>
                          <td className="px-3 py-2.5 align-top">
                            <div className="break-words font-medium text-slate-900 dark:text-slate-100">{c.header}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                              <span>{c.filled}/{rows.length} filled</span>
                              {t && fromAuto && !profile && <span className="rounded bg-blue-50 px-1 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">auto</span>}
                              {t && !fromAuto && <span className="rounded bg-violet-50 px-1 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">custom</span>}
                              {changed && <span className="rounded bg-amber-50 px-1 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">not applied</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            {!c.has_data ? (
                              <span className="text-xs italic text-slate-400">Not kept for this upload</span>
                            ) : c.samples.length ? (
                              <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                                {c.samples.map((s, i) => <li key={i} className="line-clamp-2 break-words" title={s}>{s}</li>)}
                              </ul>
                            ) : (
                              <span className="text-xs text-slate-400">Empty in every row</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <FieldPicker header={c.header} value={t} targets={targets} usedBy={usedBy} onChange={(v) => setField(c.header, v)} />
                          </td>
                          <td className="px-3 py-2.5 align-top text-xs">
                            {target ? (
                              <>
                                <div className="break-words font-mono text-[11px] text-slate-700 dark:text-slate-300">{target.stored}</div>
                                <div className="mt-0.5 text-slate-500">{target.description}</div>
                              </>
                            ) : (
                              <span className="text-slate-500">{c.note || "Not imported — the value stays in the upload history only."}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {shownColumns.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">No columns in this view.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Fields the file does not provide */}
              {(() => {
                const missing = targets.filter((t) => !t.disabled && !t.legacy && !usedBy.has(t.name));
                if (!missing.length) return null;
                return (
                  <p className="mt-3 text-xs text-slate-500">
                    Not in this file: {missing.map((t) => t.label).join(", ")}.
                  </p>
                );
              })()}
            </div>
          )}

          {data && tab === "matches" && (
            <ImportMatches
              batchId={batchId}
              data={matches}
              busy={matchBusy || !!busy}
              stale={dirty}
              onDecide={(decisions) => void putMatches({ decisions })}
              onThreshold={(threshold) => void putMatches({ threshold })}
            />
          )}

          {data && tab === "rows" && (
            <div className="p-4 sm:p-6">
              <p className="mb-2 text-xs text-slate-500">
                Every column of the file. Columns that are not imported are greyed out.{rows.length > ROW_LIMIT && !showAll ? ` Showing the first ${ROW_LIMIT} of ${rows.length} rows.` : ""}
              </p>
              <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="sticky left-0 z-10 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-500 dark:bg-slate-800">Row</th>
                      {columns.map((c) => {
                        const t = draft[c.header];
                        return (
                          <th key={c.header} className={`min-w-[140px] max-w-[260px] px-2 py-2 text-left align-bottom ${t ? "" : "opacity-50"}`}>
                            <div className="truncate font-semibold text-slate-800 dark:text-slate-100" title={c.header}>{c.header}</div>
                            <div className="truncate text-[10px] font-normal text-slate-500">{t ? `→ ${targetBy.get(t)?.label ?? t}` : "not imported"}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(showAll ? rows : rows.slice(0, ROW_LIMIT)).map((r) => (
                      <tr key={r.rowNumber} className={r.state === "invalid" ? "bg-red-50/60 dark:bg-red-500/5" : ""}>
                        <td className="sticky left-0 bg-white px-2 py-1.5 font-medium tabular-nums text-slate-500 dark:bg-slate-900">
                          {r.rowNumber}
                          {r.state === "invalid" && <AlertTriangle className="ml-1 inline h-3 w-3 text-red-500" />}
                        </td>
                        {columns.map((c) => (
                          <td key={c.header} className={`max-w-[260px] truncate px-2 py-1.5 text-slate-700 dark:text-slate-300 ${draft[c.header] ? "" : "opacity-50"}`} title={r.raw?.[c.header] ?? ""}>
                            {r.raw?.[c.header] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > ROW_LIMIT && !showAll && (
                <button onClick={() => setShowAll(true)} className="mt-2 text-sm font-medium text-blue-600 hover:underline">Show all {rows.length} rows</button>
              )}
            </div>
          )}

          {data && tab === "issues" && (
            <div className="p-4 sm:p-6">
              {issues.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /> No problems found in the rows.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                  {issues.slice(0, 500).map((i, n) => (
                    <li key={n} className="flex gap-3 px-3 py-2">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${i.error ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"}`}>
                        {i.error ? "Error" : "Warning"}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-500">Row {i.row}</span>
                      <span className="min-w-0 text-slate-700 dark:text-slate-300"><span className="font-medium">{targetBy.get(i.field)?.label ?? i.field}:</span> {i.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:px-6 dark:border-slate-700">
          {confirmCancel ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-700 dark:text-slate-200">Remove this upload? Nothing has been imported yet.</span>
              <button onClick={cancelImport} disabled={busy === "cancel"} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {busy === "cancel" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Yes, cancel import
              </button>
              <button onClick={() => setConfirmCancel(false)} className="rounded-lg px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Keep</button>
            </div>
          ) : (
            <button onClick={() => setConfirmCancel(true)} disabled={!!busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10">
              <Trash2 className="h-4 w-4" /> Cancel import
            </button>
          )}
          {flash && (
            <span role="status" className={`text-sm sm:ml-3 ${flash.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>{flash.text}</span>
          )}
          <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
            <button onClick={onClose} disabled={!!busy} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" title="Keep this upload in preview and come back to it from the import history">
              Close, decide later
            </button>
            {dirty && (
              <button onClick={apply} disabled={!!busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                {busy === "apply" && <Loader2 className="h-4 w-4 animate-spin" />} Apply mapping &amp; recheck
              </button>
            )}
            <button
              onClick={!dirty && toDecide > 0 ? () => setTab("matches") : runImport}
              disabled={!!busy || matchBusy || !data || !matches || !canImport || (!dirty && toDecide > 0 && tab === "matches")}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "import" && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy === "import"
                ? "Importing…"
                : dirty
                  ? "Apply mapping & import"
                  : !matches
                    ? "Checking for matches…"
                    : toDecide > 0
                      ? `Decide ${toDecide} match${toDecide === 1 ? "" : "es"}`
                      : toImport > 0
                        ? `Import ${toImport} alert${toImport === 1 ? "" : "s"}`
                        : "Finish import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
