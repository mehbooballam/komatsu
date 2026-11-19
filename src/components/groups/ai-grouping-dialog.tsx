"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, Sparkles, Loader2, Check, AlertTriangle, Layers, ArrowRight, ExternalLink, History, Info } from "lucide-react";
import { askChangeComment } from "@/components/layout/change-comment";
import { VERSION_LABELS, type VersionType } from "@/lib/grouping/labels";

/* ---------- Types (mirror lib/grouping/ai.ts) ---------- */

interface PGroup {
  ref: string;
  level: "family" | "action";
  parent_existing_id: string | null;
  parent_ref: string | null;
  title: string;
  jurisdiction: string | null;
  authority: string | null;
  key_identifier: string | null;
  identifiers: Array<{ kind: string; value: string }>;
  description: string;
}
interface PAssign {
  alert_id: string;
  alert_title: string;
  external_alert_id: string | null;
  current_group_path: string | null;
  existing_group_id: string | null;
  group_ref: string | null;
  target_path: string;
  version_type: string | null;
  confidence: number;
  reason: string;
  unchanged: boolean;
}
interface Proposal {
  groups: PGroup[];
  assignments: PAssign[];
  ungrouped: Array<{ alert_id: string; alert_title: string; reason: string; theme?: string | null }>;
  alerts_total: number;
  batches: number;
  pages_read: number;
}
interface Run {
  id: string;
  status: "running" | "proposed" | "applied" | "failed" | "discarded";
  mode: string;
  scope: string;
  trigger: string;
  provider: string | null;
  model: string | null;
  progress: { step?: string; done?: number; total?: number; batch?: number; batches?: number; groups?: number };
  proposal?: Proposal | null;
  result?: { groups_created: number; groups_reused: number; alerts_placed: number; needs_review: number; skipped: number; by_theme?: number } | null;
  usage?: { input_tokens?: number; output_tokens?: number; requests?: number };
  error: string | null;
  created_at: string;
  finished_at: string | null;
  proposed_groups?: number;
  proposed_assignments?: number;
  created_by_name?: string | null;
}
interface Info {
  ready: boolean;
  enabled: boolean;
  provider: string;
  model: string | null;
  can_run: boolean;
  runs: Run[];
}

type Tab = "new" | "existing" | "ungrouped";

function Confidence({ value, autoAccept }: { value: number; autoAccept: number }) {
  const tone = value >= autoAccept
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
    : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`} title={value >= autoAccept ? "Accepted" : "Will wait in Needs review"}>
      {value}%
    </span>
  );
}

const STATUS: Record<Run["status"], { label: string; cls: string }> = {
  running: { label: "Running", cls: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" },
  proposed: { label: "Ready to review", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  applied: { label: "Applied", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" },
  discarded: { label: "Discarded", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

export function AiGroupingDialog({ open, onClose, onApplied, isAdmin }: { open: boolean; onClose: () => void; onApplied: () => void; isAdmin: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [thresholds, setThresholds] = useState({ auto_accept: 90, min: 60, theme_fallback: true });
  // Alerts without a group, by theme (for "Group by theme")
  const [themes, setThemes] = useState<{ themes: Array<{ theme: string; alerts: number }>; no_theme: number } | null>(null);
  const [scope, setScope] = useState<"ungrouped" | "all_automatic">("ungrouped");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const [skipGroups, setSkipGroups] = useState<Set<string>>(new Set());
  const [skipAlerts, setSkipAlerts] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<string | null>(null);

  const loadInfo = useCallback(async () => {
    const r = await fetch("/api/groups/ai");
    if (r.ok) {
      const j: Info = await r.json();
      setInfo(j);
      return j;
    }
    return null;
  }, []);

  const loadRun = useCallback(async (id: string) => {
    const r = await fetch(`/api/groups/ai/${id}`);
    if (!r.ok) return;
    const j = await r.json();
    setRun(j.run);
    setThresholds(j.thresholds);
  }, []);

  const loadThemes = useCallback(async () => {
    const r = await fetch("/api/groups/themes");
    if (r.ok) setThemes(await r.json());
  }, []);

  // Open: show the run in progress or waiting for review, if any
  useEffect(() => {
    if (!open) return;
    setDone(null);
    setError(null);
    void loadThemes();
    void loadInfo().then((j) => {
      const current = j?.runs.find((r) => r.status === "running" || r.status === "proposed");
      if (current) {
        setRunId(current.id);
        void loadRun(current.id);
      } else {
        setRunId(null);
        setRun(null);
      }
    });
  }, [open, loadInfo, loadRun, loadThemes]);

  // Poll while running
  useEffect(() => {
    if (!open || !runId || (run && run.status !== "running")) return;
    const t = setInterval(() => void loadRun(runId), 2000);
    return () => clearInterval(t);
  }, [open, runId, run, loadRun]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const proposal = run?.status === "proposed" || run?.status === "applied" ? run.proposal ?? null : null;
  const groupsByRef = useMemo(() => new Map((proposal?.groups ?? []).map((g) => [g.ref, g])), [proposal]);
  const families = useMemo(() => (proposal?.groups ?? []).filter((g) => g.level === "family"), [proposal]);
  const orphanActions = useMemo(() => (proposal?.groups ?? []).filter((g) => g.level === "action" && !g.parent_ref), [proposal]);
  const byGroup = useMemo(() => {
    const m = new Map<string, PAssign[]>();
    for (const a of proposal?.assignments ?? []) if (a.group_ref) (m.get(a.group_ref) ?? m.set(a.group_ref, []).get(a.group_ref)!).push(a);
    return m;
  }, [proposal]);
  const toExisting = useMemo(() => (proposal?.assignments ?? []).filter((a) => a.existing_group_id), [proposal]);

  if (!open) return null;

  // Selection
  const groupSkipped = (ref: string | null): boolean => {
    if (!ref) return false;
    if (skipGroups.has(ref)) return true;
    const g = groupsByRef.get(ref);
    return !!g?.parent_ref && skipGroups.has(g.parent_ref);
  };
  const included = (a: PAssign) => !a.unchanged && !skipAlerts.has(a.alert_id) && !groupSkipped(a.group_ref);
  const chosen = (proposal?.assignments ?? []).filter(included);
  const chosenNewGroups = (proposal?.groups ?? []).filter((g) => !groupSkipped(g.ref) && (byGroup.get(g.ref)?.some(included) || (proposal?.groups ?? []).some((c) => c.parent_ref === g.ref && !groupSkipped(c.ref) && byGroup.get(c.ref)?.some(included))));
  const willReview = chosen.filter((a) => a.confidence < thresholds.auto_accept).length;
  // Alerts AI could not place that go into their theme group on apply
  const byTheme = thresholds.theme_fallback ? (proposal?.ungrouped ?? []).filter((u) => u.theme).length : 0;
  const applyLabel = chosen.length
    ? `Apply ${chosen.length} placement${chosen.length === 1 ? "" : "s"}${byTheme ? ` + ${byTheme} by theme` : ""}`
    : `Apply · group ${byTheme} by theme`;
  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/groups/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not start");
      setRunId(j.runId);
      setRun(null);
      await loadRun(j.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!run) return;
    const comment = await askChangeComment({
      action: `Apply AI grouping: ${chosen.length} alert${chosen.length === 1 ? "" : "s"}, ${chosenNewGroups.length} new group${chosenNewGroups.length === 1 ? "" : "s"}${byTheme ? `, ${byTheme} by theme` : ""}`,
      detail: willReview ? `${willReview} placement${willReview === 1 ? "" : "s"} below ${thresholds.auto_accept}% will wait in Needs review` : "Recorded on each alert with the model's reason",
    });
    if (!comment) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/groups/ai/${run.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", exclude_groups: [...skipGroups], exclude_alerts: [...skipAlerts], comment }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not apply");
      const res = j.result;
      setDone(`Placed ${res.alerts_placed} alert${res.alerts_placed === 1 ? "" : "s"}, created ${res.groups_created} group${res.groups_created === 1 ? "" : "s"}${res.groups_reused ? ` (${res.groups_reused} matched existing keys)` : ""}${res.needs_review ? ` · ${res.needs_review} wait in Needs review` : ""}${res.skipped ? ` · ${res.skipped} skipped (changed meanwhile)` : ""}${res.by_theme ? ` · ${res.by_theme} grouped by theme` : ""}.`);
      void loadThemes();
      await loadRun(run.id);
      await loadInfo();
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply");
    } finally {
      setBusy(false);
    }
  }

  async function groupThemes() {
    const n = themes?.themes.reduce((s, t) => s + t.alerts, 0) ?? 0;
    const comment = await askChangeComment({
      action: `Group ${n} alert${n === 1 ? "" : "s"} without a group by theme`,
      detail: "Each goes into a “Theme: …” group until a regulation group is found",
    });
    if (!comment) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/groups/themes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not group by theme");
      setDone(`Grouped ${j.result.placed} alert${j.result.placed === 1 ? "" : "s"} by theme${j.result.groups_created ? ` (${j.result.groups_created} new theme group${j.result.groups_created === 1 ? "" : "s"})` : ""}.`);
      await loadThemes();
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not group by theme");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!run) return;
    setBusy(true);
    await fetch(`/api/groups/ai/${run.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard" }) });
    setBusy(false);
    setRunId(null);
    setRun(null);
    setSkipAlerts(new Set());
    setSkipGroups(new Set());
    await loadInfo();
  }

  const openRun = (id: string) => {
    setRunId(id);
    setRun(null);
    setSkipAlerts(new Set());
    setSkipGroups(new Set());
    setDone(null);
    void loadRun(id);
  };

  /* ---------- Pieces ---------- */

  const alertRow = (a: PAssign, showTarget = false) => {
    const on = included(a);
    const disabled = a.unchanged || run?.status !== "proposed" || groupSkipped(a.group_ref);
    return (
      <li key={a.alert_id} className={`flex gap-2.5 px-3 py-2 ${on ? "" : "opacity-60"}`}>
        <input
          type="checkbox"
          aria-label={`Include ${a.alert_title}`}
          className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
          checked={on}
          disabled={disabled}
          onChange={() => toggle(skipAlerts, a.alert_id, setSkipAlerts)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 break-words text-sm font-medium text-slate-900 dark:text-slate-100">{a.alert_title}</span>
            <Confidence value={a.confidence} autoAccept={thresholds.auto_accept} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
            {a.external_alert_id && <span className="font-mono">{a.external_alert_id}</span>}
            {a.version_type && <span>{VERSION_LABELS[a.version_type as VersionType] ?? a.version_type}</span>}
            {a.unchanged && <span className="rounded bg-slate-100 px-1 dark:bg-slate-800">already in this group</span>}
            {!a.unchanged && a.current_group_path && <span>now in {a.current_group_path}</span>}
          </div>
          {showTarget && (
            <div className="mt-1 flex items-center gap-1 text-xs text-indigo-700 dark:text-indigo-300">
              <ArrowRight className="h-3 w-3 shrink-0" /> <span className="break-words">{a.target_path}</span>
            </div>
          )}
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{a.reason}</p>
        </div>
      </li>
    );
  };

  const groupCard = (g: PGroup, child = false) => {
    const members = byGroup.get(g.ref) ?? [];
    const actions = (proposal?.groups ?? []).filter((c) => c.parent_ref === g.ref);
    const skipped = groupSkipped(g.ref);
    return (
      <div key={g.ref} className={`rounded-lg border ${child ? "border-slate-200 dark:border-slate-700" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"} ${skipped ? "opacity-60" : ""}`}>
        <div className="flex gap-2.5 p-3">
          <input
            type="checkbox"
            aria-label={`Create ${g.title}`}
            className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
            checked={!skipped}
            disabled={run?.status !== "proposed" || (!!g.parent_ref && skipGroups.has(g.parent_ref))}
            onChange={() => toggle(skipGroups, g.ref, setSkipGroups)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${g.level === "family" ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"}`}>
                {g.level === "family" ? "New family" : "New action"}
              </span>
              <span className="break-words font-semibold text-slate-900 dark:text-white">{g.title}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
              {g.jurisdiction && <span>Jurisdiction: <strong className="font-medium text-slate-700 dark:text-slate-300">{g.jurisdiction}</strong></span>}
              {g.authority && <span>Authority: <strong className="font-medium text-slate-700 dark:text-slate-300">{g.authority}</strong></span>}
              {g.key_identifier && <span>Key: <strong className="font-mono font-medium text-slate-700 dark:text-slate-300">{g.key_identifier}</strong></span>}
              {g.parent_existing_id && <span>inside an existing family</span>}
            </div>
            {g.identifiers.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {g.identifiers.map((i) => (
                  <span key={`${i.kind}:${i.value}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">{i.value}</span>
                ))}
              </div>
            )}
            {g.description && <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">{g.description}</p>}
          </div>
        </div>
        {members.length > 0 && (
          <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">{members.map((a) => alertRow(a))}</ul>
        )}
        {actions.length > 0 && <div className="space-y-2 border-t border-slate-100 p-3 pl-8 dark:border-slate-800">{actions.map((c) => groupCard(c, true))}</div>}
      </div>
    );
  };

  /* ---------- Render ---------- */

  const p = run?.progress ?? {};
  const pct = p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : 0;
  const pastRuns = (info?.runs ?? []).filter((r) => r.id !== runId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="AI grouping">
      <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6 dark:border-slate-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white"><Sparkles className="h-5 w-5 text-violet-600" /> AI grouping</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {info?.model ? <>{info.provider} · <span className="font-mono">{run?.model ?? info.model}</span></> : "Groups alerts by regulation using your language model"}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
          {done && <p className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"><Check className="h-4 w-4" /> {done}</p>}

          {!info && <div className="h-32 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />}

          {/* Group what is left by theme */}
          {!run && themes && (themes.themes.length > 0 || themes.no_theme > 0) && (
            <div className="mb-5 rounded-lg border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-500/30 dark:bg-violet-500/5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {themes.themes.reduce((s, t) => s + t.alerts, 0) + themes.no_theme} alerts are not in any group
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                    Group them by regulatory theme (their first Daptic topic). They stay in the theme group until the rules or AI find their regulation.
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {themes.themes.map((t) => (
                      <li key={t.theme} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-violet-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-violet-500/30">
                        {t.theme} <span className="font-semibold">{t.alerts}</span>
                      </li>
                    ))}
                    {themes.no_theme > 0 && <li className="rounded-full px-2 py-0.5 text-xs text-slate-500">{themes.no_theme} without a topic stay ungrouped</li>}
                  </ul>
                </div>
                {info?.can_run && themes.themes.length > 0 && (
                  <button onClick={groupThemes} disabled={busy} className="shrink-0 rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-500/40 dark:bg-slate-900 dark:text-violet-300">
                    Group by theme
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Not set up */}
          {info && !info.ready && !run && (
            <div className="rounded-lg border border-slate-200 p-6 text-center dark:border-slate-700">
              <Sparkles className="mx-auto h-8 w-8 text-violet-500" />
              <p className="mt-2 font-semibold text-slate-900 dark:text-white">AI grouping is not set up</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">An administrator adds an API key, chooses a model and turns it on in Settings › AI grouping.</p>
              {isAdmin && (
                <Link href="/settings?tab=ai" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  Open settings <ExternalLink className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}

          {/* Start */}
          {info?.ready && !run && (
            <div className="space-y-5">
              <div className="rounded-lg bg-violet-50 p-4 text-sm text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  The model reviews every field of each alert and its source link, compares them with the existing groups, and proposes which regulation each alert belongs to. You review the proposal before anything changes. Alerts grouped by hand are never moved.
                </p>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">Which alerts</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ["ungrouped", "Alerts not in a group", "Recommended after an import"],
                    ["all_automatic", "All alerts except those grouped by hand", "Also re-checks groupings made by the rules or earlier AI runs"],
                  ] as const).map(([v, label, hint]) => (
                    <label key={v} className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm ${scope === v ? "border-blue-400 bg-blue-50 dark:border-blue-500/50 dark:bg-blue-500/10" : "border-slate-200 dark:border-slate-700"}`}>
                      <span className="flex items-center gap-2 font-medium"><input type="radio" name="ai-scope" className="accent-blue-600" checked={scope === v} onChange={() => setScope(v)} /> {label}</span>
                      <span className="mt-1 pl-5 text-xs text-slate-500">{hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {pastRuns.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200"><History className="h-4 w-4" /> Earlier runs</h3>
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                    {pastRuns.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                        <span className="text-slate-700 dark:text-slate-200">{new Date(r.created_at).toLocaleString()}</span>
                        <span className="text-xs text-slate-500">
                          {r.trigger === "import" ? "after import" : r.created_by_name ? `by ${r.created_by_name}` : ""}
                          {r.result ? ` · ${r.result.alerts_placed} placed, ${r.result.groups_created} groups created` : r.proposed_assignments != null ? ` · ${r.proposed_assignments} proposed` : ""}
                          {r.error ? ` · ${r.error}` : ""}
                        </span>
                        {(r.status === "applied" || r.status === "proposed") && (
                          <button onClick={() => openRun(r.id)} className="ml-auto text-xs font-medium text-blue-600 hover:underline">View</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Running */}
          {run?.status === "running" && (
            <div className="mx-auto max-w-xl py-10 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-violet-600" />
              <p className="mt-3 font-semibold text-slate-900 dark:text-white">
                {p.step === "pages" ? "Reading source links" : p.step === "grouping" ? "Asking the model" : "Starting"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {p.step === "pages" && `${p.done ?? 0} of ${p.total ?? 0} links`}
                {p.step === "grouping" && `Batch ${Math.min((p.batch ?? 0) + 1, p.batches ?? 1)} of ${p.batches ?? "…"} · ${p.done ?? 0} of ${p.total ?? 0} alerts reviewed · ${p.groups ?? 0} new groups so far`}
              </p>
              <div className="mx-auto mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${p.step === "grouping" || p.step === "pages" ? Math.max(4, pct) : 4}%` }} />
              </div>
              <p className="mt-4 text-xs text-slate-500">Large files take a few minutes. You can close this window; the run continues and waits for your review.</p>
            </div>
          )}

          {run?.status === "failed" && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> The run failed</p>
              <p className="mt-1">{run.error}</p>
            </div>
          )}

          {/* Proposal */}
          {proposal && (
            <div>
              <div className="mb-4 flex flex-wrap gap-2 text-sm">
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium dark:bg-slate-800">{proposal.alerts_total} alerts reviewed</span>
                <span className="rounded-lg bg-blue-50 px-2.5 py-1 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{proposal.groups.length} new groups</span>
                <span className="rounded-lg bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{toExisting.filter((a) => !a.unchanged).length} into existing groups</span>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{proposal.ungrouped.length} not grouped</span>
                {run?.usage?.requests ? (
                  <span className="rounded-lg px-2.5 py-1 text-xs text-slate-500">
                    {run.usage.requests} request{run.usage.requests === 1 ? "" : "s"} · {((run.usage.input_tokens ?? 0) / 1000).toFixed(0)}k in / {((run.usage.output_tokens ?? 0) / 1000).toFixed(0)}k out tokens · {proposal.pages_read} pages read
                  </span>
                ) : null}
              </div>
              {run?.status === "applied" && run.result && (
                <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                  Applied: {run.result.alerts_placed} alerts placed, {run.result.groups_created} groups created{run.result.needs_review ? `, ${run.result.needs_review} waiting in Needs review` : ""}{run.result.by_theme ? `, ${run.result.by_theme} grouped by theme` : ""}.
                </p>
              )}

              <div className="mb-3 flex gap-1 border-b border-slate-200 dark:border-slate-700" role="tablist">
                {([
                  ["new", `New groups (${proposal.groups.length})`],
                  ["existing", `Into existing groups (${toExisting.length})`],
                  ["ungrouped", `Not grouped (${proposal.ungrouped.length})`],
                ] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === "new" && (
                <div className="space-y-3">
                  {proposal.groups.length === 0 && <p className="text-sm text-slate-500">No new groups proposed.</p>}
                  {families.map((g) => groupCard(g))}
                  {orphanActions.map((g) => groupCard(g))}
                </div>
              )}
              {tab === "existing" && (
                toExisting.length === 0 ? <p className="text-sm text-slate-500">No alerts proposed for existing groups.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">{toExisting.map((a) => alertRow(a, true))}</ul>
                )
              )}
              {tab === "ungrouped" && (
                proposal.ungrouped.length === 0 ? <p className="text-sm text-slate-500">Every alert was placed.</p> : (
                  <>
                  {run?.status === "proposed" && (
                    <p className="mb-3 rounded-lg bg-violet-50 p-3 text-xs text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">
                      {thresholds.theme_fallback
                        ? `When you apply, these go into their theme group (${proposal.ungrouped.filter((u) => u.theme).length} with a theme). Turn this off in Settings › AI grouping.`
                        : "These stay without a group. Turn on “Group what AI can't place by regulatory theme” in Settings › AI grouping to place them by theme."}
                    </p>
                  )}
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                    {proposal.ungrouped.map((u) => (
                      <li key={u.alert_id} className="px-3 py-2">
                        <div className="flex flex-wrap items-start gap-2">
                          <span className="min-w-0 flex-1 font-medium text-slate-900 dark:text-slate-100">{u.alert_title}</span>
                          <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                            {u.theme ? `Theme: ${u.theme}` : "No theme"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{u.reason}</p>
                      </li>
                    ))}
                  </ul>
                  </>
                )
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:px-6 dark:border-slate-700">
          {run?.status === "proposed" && (
            <button onClick={discard} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10">Discard proposal</button>
          )}
          {run && run.status !== "running" && run.status !== "proposed" && (
            <button onClick={() => { setRunId(null); setRun(null); setDone(null); }} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">New run</button>
          )}
          <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:items-center">
            {run?.status === "proposed" && (
              <span className="text-xs text-slate-500">
                {chosen.length} alerts · {chosenNewGroups.length} new groups{willReview ? ` · ${willReview} below ${thresholds.auto_accept}% go to Needs review` : ""}
              </span>
            )}
            <button onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Close</button>
            {info?.ready && !run && info.can_run && (
              <button onClick={start} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Start AI grouping
              </button>
            )}
            {run?.status === "proposed" && info?.can_run && (
              <button onClick={apply} disabled={busy || (chosen.length === 0 && byTheme === 0)} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />} {applyLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
