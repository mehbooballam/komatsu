"use client";

import { useCallback, useEffect, useState } from "react";
import { X, CalendarPlus, CheckCircle2, Loader2, Trash2, Check, CalendarClock, AlertTriangle } from "lucide-react";

interface Deadline {
  id: string;
  kind: string;
  date_value: string;
  applies_to: string | null;
  verification_state: string;
  lifecycle_state: string;
  origin: string | null;
  confirmed_by_name?: string | null;
}

const KINDS: Array<{ value: string; label: string; hint: string }> = [
  { value: "compliance", label: "Compliance deadline", hint: "Date you must comply by — drives urgency when confirmed" },
  { value: "effective", label: "Effective date", hint: "When the rule takes effect" },
  { value: "comment", label: "Comment period ends", hint: "Last day to submit comments" },
  { value: "proposed", label: "Proposed date", hint: "Not final yet" },
  { value: "internal", label: "Internal target", hint: "Your own target date" },
];

const KIND_STYLE: Record<string, string> = {
  compliance: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  effective: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30",
  comment: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30",
  proposed: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  internal: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30",
  unknown: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600",
};

function kindLabel(kind: string) {
  return KINDS.find((k) => k.value === kind)?.label ?? (kind === "unknown" ? "From import" : kind);
}

function isoToday(offsetDays = 0, offsetMonths = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(d: string) {
  const date = new Date(`${d.slice(0, 10)}T00:00:00`);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function daysFromToday(d: string) {
  const a = new Date(`${d.slice(0, 10)}T00:00:00`).getTime();
  const t = new Date();
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}

const QUICK = [
  { label: "+30 days", days: 30, months: 0 },
  { label: "+90 days", days: 90, months: 0 },
  { label: "+6 months", days: 0, months: 6 },
  { label: "+1 year", days: 0, months: 12 },
];

interface DeadlineDialogProps {
  alertId: string;
  alertTitle?: string;
  onClose: () => void;
  /** Called after any change so lists/scores can refresh. */
  onChanged?: () => void;
  canEdit?: boolean;
}

export function DeadlineDialog({ alertId, alertTitle, onClose, onChanged, canEdit = true }: DeadlineDialogProps) {
  const [deadlines, setDeadlines] = useState<Deadline[] | null>(null);
  const [date, setDate] = useState("");
  const [kind, setKind] = useState("compliance");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/alerts/${alertId}/deadline`);
    const body = await res.json().catch(() => ({}));
    setDeadlines(res.ok ? body.deadlines || [] : []);
  }, [alertId]);

  // Initial load; setState only runs once the request resolves
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/alerts/${alertId}/deadline`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setDeadlines(res.ok ? body.deadlines || [] : []);
      })
      .catch(() => !cancelled && setDeadlines([]));
    return () => {
      cancelled = true;
    };
  }, [alertId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function call(label: string, key: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/deadline`, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${label} failed`);
      await load();
      setFlash(label);
      onChanged?.();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      setError("Pick a date");
      return;
    }
    const ok = await call("Deadline added", "add", {
      method: "POST",
      body: JSON.stringify({
        date_value: date,
        kind,
        applies_to: note.trim() || null,
        verification_state: confirmed ? "verified" : "unverified",
      }),
    });
    if (ok) {
      setDate("");
      setNote("");
    }
  };

  const update = (d: Deadline, patch: Record<string, string>, label: string) =>
    call(label, d.id, { method: "PUT", body: JSON.stringify({ deadline_id: d.id, ...patch }) });

  const active = (deadlines || []).filter((d) => d.lifecycle_state === "outstanding");
  const closed = (deadlines || []).filter((d) => d.lifecycle_state !== "outstanding");
  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="deadline-title" className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              <CalendarClock className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h3 id="deadline-title" className="text-base font-bold text-slate-900 dark:text-white">Deadlines</h3>
              {alertTitle && <p className="truncate text-xs text-slate-500">{alertTitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Existing */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Current deadlines</p>
            {deadlines === null ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
            ) : active.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500 dark:border-slate-700">No deadline on this alert yet.</p>
            ) : (
              <ul className="space-y-2">
                {active.map((d) => {
                  const days = daysFromToday(d.date_value);
                  const isConfirmed = d.verification_state === "verified";
                  return (
                    <li key={d.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{formatDate(d.date_value)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${KIND_STYLE[d.kind] || KIND_STYLE.unknown}`}>{kindLabel(d.kind)}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            days < 0
                              ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                              : days <= 30
                              ? "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`}
                        </span>
                        {isConfirmed ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmed</span>
                        ) : (
                          <span className="text-[11px] font-medium text-amber-600">Unconfirmed</span>
                        )}
                      </div>
                      {d.applies_to && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{d.applies_to}</p>}
                      {canEdit && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(!isConfirmed || d.kind !== "compliance") && (
                            <button
                              disabled={!!busy}
                              onClick={() => update(d, { verification_state: "verified", kind: "compliance" }, "Confirmed as compliance deadline")}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <Check className="h-3.5 w-3.5" /> Confirm as compliance deadline
                            </button>
                          )}
                          <button
                            disabled={!!busy}
                            onClick={() => update(d, { lifecycle_state: "completed" }, "Marked as met")}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Mark as met
                          </button>
                          <button
                            disabled={!!busy}
                            onClick={() => update(d, { lifecycle_state: "withdrawn" }, "Deadline removed")}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </button>
                          {busy === d.id && <Loader2 className="h-4 w-4 animate-spin self-center text-slate-400" />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {closed.length > 0 && (
              <details className="mt-2 text-xs text-slate-500">
                <summary className="cursor-pointer select-none">{closed.length} past / removed</summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {closed.map((d) => (
                    <li key={d.id}>
                      {formatDate(d.date_value)} · {kindLabel(d.kind)} · {d.lifecycle_state === "completed" ? "met" : d.lifecycle_state}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Add */}
          {canEdit && (
            <form onSubmit={add} className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-500/30 dark:bg-blue-500/5">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <CalendarPlus className="h-4 w-4 text-blue-600" /> Add a deadline
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Date
                  <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${inputCls}`} />
                </label>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Type
                  <select value={kind} onChange={(e) => setKind(e.target.value)} className={`mt-1 ${inputCls}`}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => setDate(isoToday(q.days, q.months))}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">{KINDS.find((k) => k.value === kind)?.hint}</p>
              <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Note <span className="font-normal text-slate-400">(optional — e.g. which products or which obligation)</span>
                <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Applies to…" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="mt-3 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
                <span>
                  Confirmed
                  <span className="block text-xs text-slate-500">
                    {kind === "compliance"
                      ? "A confirmed compliance deadline sets the Urgency score and the “days left” countdown."
                      : "Only compliance deadlines affect the score."}
                  </span>
                </span>
              </label>
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={!date || !!busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Add deadline
                </button>
              </div>
            </form>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
          {flash && !error && (
            <div role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> {flash} — score updated.
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
