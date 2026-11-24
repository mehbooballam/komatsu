"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Ban, CheckCircle2, ChevronDown, ChevronRight, Loader2, Plus, Replace } from "lucide-react";

/* ---------- Types (GET /api/imports/[id]/matches) ---------- */

export type MatchAction = "replace" | "ignore" | "add";

export interface MatchOption {
  target: string;
  title: string;
  external_alert_id: string;
  score: number;
  compared: number;
  identical: number;
}

export interface RowMatch {
  row: number;
  title: string;
  external_alert_id: string;
  kind: "id" | "content";
  matches: MatchOption[];
  decision: MatchAction | null;
  target: string | null;
  source: "user" | "default" | "earlier" | null;
  conflict: string | null;
}

export interface MatchesResponse {
  threshold: number;
  rows: RowMatch[];
  undecided: number;
  conflicts: number;
  totals: { create: number; update: number; unchanged: number; skip: number };
}

interface Comparison {
  score: number;
  compared: number;
  identical: number;
  columns: Array<{ column: string; label: string; score: number; incoming: string | null; existing: string | null }>;
}

export interface DecisionInput {
  row: number;
  action: MatchAction | null;
  target: string;
}

const ACTIONS: Array<{ key: MatchAction; label: string; icon: typeof Replace; on: string }> = [
  { key: "replace", label: "Replace", icon: Replace, on: "bg-blue-600 text-white border-blue-600" },
  { key: "ignore", label: "Ignore", icon: Ban, on: "bg-slate-700 text-white border-slate-700 dark:bg-slate-200 dark:text-slate-900" },
  { key: "add", label: "Add as new", icon: Plus, on: "bg-emerald-600 text-white border-emerald-600" },
];

const THRESHOLDS = [50, 60, 70, 80, 90, 100];

function scoreStyle(score: number) {
  if (score >= 95) return "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30";
  if (score >= 80) return "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30";
  return "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30";
}

/* ---------- Column-by-column comparison ---------- */

function CompareTable({ batchId, row, target, other }: { batchId: string; row: number; target: string; other: string }) {
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState(false);
  const [onlyDifferent, setOnlyDifferent] = useState(false);

  useEffect(() => {
    let gone = false;
    fetch(`/api/imports/${batchId}/matches?row=${row}&target=${encodeURIComponent(target)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => !gone && setData(d))
      .catch(() => !gone && setError(true));
    return () => {
      gone = true;
    };
  }, [batchId, row, target]);

  if (error) return <p className="px-4 py-3 text-sm text-red-600">Could not load the comparison.</p>;
  if (!data) return <p className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Comparing columns…</p>;
  const shown = onlyDifferent ? data.columns.filter((c) => c.score < 100) : data.columns;
  return (
    <div className="border-t border-slate-200 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-slate-600 dark:text-slate-300">
        <span>{data.identical} of {data.compared} columns are the same. Descriptive columns count more than ratings.</span>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={onlyDifferent} onChange={(e) => setOnlyDifferent(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 accent-[var(--primary)]" />
          Only differences
        </label>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="w-[18%] px-4 py-2">Column</th>
              <th className="w-[8%] px-2 py-2 text-right">Match</th>
              <th className="px-3 py-2">This row ({row})</th>
              <th className="px-3 py-2">{other}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((c) => (
              <tr key={c.column} className={c.score < 100 ? "bg-amber-50/40 dark:bg-amber-500/5" : ""}>
                <td className="px-4 py-2 align-top font-medium text-slate-800 dark:text-slate-100">{c.label}</td>
                <td className={`px-2 py-2 text-right align-top font-semibold tabular-nums ${c.score === 100 ? "text-emerald-700 dark:text-emerald-300" : c.score === 0 ? "text-red-600 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>{c.score}%</td>
                {[c.incoming, c.existing].map((v, i) => (
                  <td key={i} className="max-w-[320px] px-3 py-2 align-top text-slate-700 dark:text-slate-300">
                    {v ? <span className="line-clamp-4 break-words" title={v}>{v}</span> : <span className="italic text-slate-400">empty</span>}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-500">Every column is the same.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- One matching row ---------- */

function MatchCard({ batchId, m, busy, onDecide }: { batchId: string; m: RowMatch; busy: boolean; onDecide: (d: DecisionInput[]) => void }) {
  const [open, setOpen] = useState(false);
  // Which match is shown: the decided one, otherwise the best one or the one picked here
  const [picked, setPicked] = useState<string | null>(null);
  const target = picked ?? m.target ?? m.matches[0].target;
  const opt = m.matches.find((x) => x.target === target) ?? m.matches[0];
  const inFile = opt.target.startsWith("row:");
  const otherLabel = inFile ? `Row ${opt.target.slice(4)} of this file` : "Existing alert";

  const pick = (t: string) => {
    setPicked(t);
    if (m.decision) onDecide([{ row: m.row, action: m.decision, target: t }]);
  };
  return (
    <li className={`overflow-hidden rounded-lg border ${m.conflict ? "border-red-300 dark:border-red-500/40" : m.decision ? "border-slate-200 dark:border-slate-700" : "border-amber-300 dark:border-amber-500/40"}`}>
      <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center">
        <span className={`inline-flex h-12 w-16 shrink-0 items-center justify-center rounded-lg text-lg font-bold tabular-nums ring-1 ${scoreStyle(opt.score)}`} title={`${opt.identical} of ${opt.compared} columns are the same`}>
          {opt.score}%
        </span>
        <div className="grid min-w-0 flex-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500">Row {m.row} · {m.external_alert_id}</p>
            <p className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-white" title={m.title}>{m.title}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500">{otherLabel} · {opt.external_alert_id}</p>
            <p className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-white" title={opt.title}>
              {inFile ? opt.title : <a href={`/alerts/${opt.target.slice(6)}`} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">{opt.title}</a>}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label={`What to do with row ${m.row}`}>
          {ACTIONS.map(({ key, label, icon: Icon, on }) => (
            <button
              key={key}
              type="button"
              disabled={busy}
              aria-pressed={m.decision === key}
              onClick={() => onDecide([{ row: m.row, action: m.decision === key && m.kind === "content" && m.source === "user" ? null : key, target }])}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${m.decision === key ? on : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-3 text-xs sm:px-4">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline dark:text-blue-400">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Compare columns
        </button>
        <span className="text-slate-500">{opt.identical} of {opt.compared} columns the same</span>
        {m.matches.length > 1 && (
          <label className="inline-flex items-center gap-1.5 text-slate-500">
            {m.matches.length} matches:
            <select value={target} disabled={busy} onChange={(e) => pick(e.target.value)} className="max-w-[16rem] rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900">
              {m.matches.map((x) => (
                <option key={x.target} value={x.target}>{x.score}% · {x.target.startsWith("row:") ? `row ${x.target.slice(4)}` : x.title}</option>
              ))}
            </select>
          </label>
        )}
        {m.source === "earlier" && <span className="text-slate-500">You ignored this row in an earlier import</span>}
        {m.conflict && <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {m.conflict}</span>}
      </div>
      {open && <CompareTable key={target} batchId={batchId} row={m.row} target={target} other={otherLabel} />}
    </li>
  );
}

/* ---------- Tab ---------- */

export function ImportMatches({
  batchId, data, busy, stale, onDecide, onThreshold,
}: {
  batchId: string;
  data: MatchesResponse | null;
  busy: boolean;
  /** The column mapping was changed but not applied yet */
  stale: boolean;
  onDecide: (d: DecisionInput[]) => void;
  onThreshold: (n: number) => void;
}) {
  const [showIds, setShowIds] = useState(false);
  if (!data) return <p className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Comparing every column with your alerts…</p>;

  const content = data.rows.filter((r) => r.kind === "content");
  const sameId = data.rows.filter((r) => r.kind === "id");
  const open = content.filter((r) => !r.decision);
  const decideAll = (action: MatchAction) => onDecide(open.map((r) => ({ row: r.row, action, target: r.target ?? r.matches[0].target })));
  const thresholds = THRESHOLDS.includes(data.threshold) ? THRESHOLDS : [...THRESHOLDS, data.threshold].sort((a, b) => a - b);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {stale && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">The column mapping changed. Apply it to compare the rows again.</p>}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <p>Every column is compared with the alerts you already have, and with the other rows of this file.</p>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            <li><strong>Replace</strong>: the matched alert gets this row&apos;s content. Its ID, owner, group, notes and score adjustments stay. Blank text cells keep the current value; ratings are taken from this row.</li>
            <li><strong>Ignore</strong>: this row is not imported.</li>
            <li><strong>Add as new</strong>: this row becomes its own alert.</li>
          </ul>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          Ask when the match is at least
          <select value={data.threshold} disabled={busy || stale} onChange={(e) => onThreshold(Number(e.target.value))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900">
            {thresholds.map((t) => <option key={t} value={t}>{t}%</option>)}
          </select>
        </label>
      </div>

      {content.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-slate-200 p-4 text-sm text-emerald-700 dark:border-slate-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> No row matches another alert at {data.threshold}% or more.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {open.length ? `${open.length} of ${content.length} matching row${content.length === 1 ? "" : "s"} to decide` : `All ${content.length} matching row${content.length === 1 ? "" : "s"} decided`}
            </span>
            {open.length > 1 && (
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500">Remaining {open.length}:</span>
                {ACTIONS.map(({ key, label, icon: Icon }) => (
                  <button key={key} type="button" disabled={busy || stale} onClick={() => decideAll(key)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <Icon className="h-3.5 w-3.5" /> {key === "add" ? "Add all as new" : `${label} all`}
                  </button>
                ))}
              </span>
            )}
          </div>
          <ul className="space-y-3">
            {content.map((m) => <MatchCard key={m.row} batchId={batchId} m={m} busy={busy || stale} onDecide={onDecide} />)}
          </ul>
        </>
      )}

      {sameId.length > 0 && (
        <section className="rounded-lg border border-slate-200 dark:border-slate-700">
          <button type="button" onClick={() => setShowIds((v) => !v)} aria-expanded={showIds} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100">
            {showIds ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <ArrowLeftRight className="h-4 w-4 text-slate-400" /> Same alert ID, changed content ({sameId.length})
            <span className="ml-1 text-xs font-normal text-slate-500">Replaced unless you choose otherwise</span>
          </button>
          {showIds && <ul className="space-y-3 px-3 pb-3">{sameId.map((m) => <MatchCard key={m.row} batchId={batchId} m={m} busy={busy || stale} onDecide={onDecide} />)}</ul>}
        </section>
      )}
    </div>
  );
}
