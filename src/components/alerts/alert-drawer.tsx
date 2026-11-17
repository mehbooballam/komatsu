"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X, ExternalLink, Clock, ChevronDown, User, Tag, FileText, AlertTriangle, Loader2,
  SlidersHorizontal, Link2, Package, FolderPlus, Check, UserPlus, UserMinus,
  CalendarCheck, Globe2, History, CheckCircle2, FolderMinus,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScoreEditor } from "@/components/alerts/score-editor";
import { useSessionInfo } from "@/components/layout/session-context";
import { StageBadge, GroupPicker, createGroup, type Group } from "@/components/alerts/alerts-table";
import { DeadlineDialog } from "@/components/alerts/deadline-dialog";
import { AlertNotes } from "@/components/alerts/alert-notes";
import { describeEvent, type Refs } from "@/lib/audit-describe";
import { Sentence, ChangeList, lowerFirst } from "@/components/audit/audit-entry";
import { ProductPicker, ProductChip, setAlertProduct, type AttachedProduct, type ProductRef } from "@/components/products/product-picker";
import { UserAvatar } from "@/components/ui/brand";

interface AlertDetail {
  alert: {
    id: string;
    external_alert_id: string;
    title: string;
    overview: string;
    summary: string;
    relevance: string;
    published_on: string;
    stage: string;
    recommendation: string;
    change_type: string;
    timing_raw: string;
    product_raw: string;
    jurisdiction_raw: string;
    agency_name: string;
    source_name: string;
    source_url: string;
    topic_match: string;
    local_state: string;
    record_version: number;
    group_id: string | null;
    group_title: string | null;
    group_path?: string[] | null;
    ownership: {
      type: string;
      effective_owner_id?: string | null;
      effective_owner_name: string | null;
      direct_owner_id?: string | null;
      direct_owner_name: string | null;
      group_owner_name: string | null;
    };
  };
  assessment: {
    effective_market_access: number | null;
    effective_cost_to_implement: number | null;
    effective_human_resources: number | null;
    effective_urgency: number | null;
    factor_urgency?: number | null;
    raw_total: number | null;
    effective_total: number | null;
    base_band: string | null;
    effective_band: string | null;
    escalation_reasons: Array<{ reason: string; description: string }>;
    review_flags: Array<{ flag: string; description: string }>;
    days_remaining: number | null;
    margin_days: number | null;
    as_of_date: string;
  } | null;
  deadlines: Array<{
    id: string;
    kind: string;
    date_value: string;
    verification_state: string;
    lifecycle_state: string;
    applies_to: string;
  }>;
  source_factors: Array<{ factor_key: string; original_value: string; parsed_value: number | null; rationale: string }>;
  active_overrides: Array<{ target: string; value: number; reason: string; expires_at: string | null }>;
  products: AttachedProduct[];
  /** Notes the viewer can see (team notes + their own private ones) */
  notes_count?: number;
  geographies: Array<{ display_name: string; code: string; state: string }>;
  topics: Array<{ normalized_key: string; source_label: string }>;
  tags: Array<{ tag_name: string; color: string }>;
  forecast: { remaining_days: number; estimated_finish_date: string; as_of_date: string; reason: string } | null;
  source_revisions: Array<{ version_number: number; observed_at: string; original_filename: string }>;
}

interface Member { id: string; display_name: string; email: string; role: string; avatar?: string | null }
interface AuditEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  occurred_at: string;
  actor_name: string | null;
  reason: string | null;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
}

const BAND_STYLE: Record<string, { chip: string; bar: string; label: string }> = {
  critical: { chip: "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30", bar: "from-violet-500 to-purple-600", label: "Critical" },
  high: { chip: "bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30", bar: "from-orange-500 to-red-500", label: "High" },
  moderate: { chip: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30", bar: "from-amber-400 to-orange-400", label: "Moderate" },
  low: { chip: "bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30", bar: "from-teal-400 to-emerald-500", label: "Low" },
  unscored: { chip: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600", bar: "from-slate-300 to-slate-400", label: "Unscored" },
};

const FACTORS = [
  { key: "market_access", label: "Market access", letter: "A" },
  { key: "cost_to_implement", label: "Cost to implement", letter: "B" },
  { key: "urgency", label: "Urgency", letter: "C" },
] as const;

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const date = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function ActionButton({ icon: Icon, label, onClick, active }: { icon: React.ElementType; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-2 text-[13px] font-medium shadow-sm transition-colors ${
        active
          ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700/70 dark:bg-slate-900/40">
      <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {Icon && <Icon className="h-3.5 w-3.5" />} {title}
      </h4>
      {children}
    </section>
  );
}

interface AlertDrawerProps {
  alertId: string | null;
  onClose: () => void;
  userRole?: string;
  /** Called after any change (owner, group, score, deadline) so lists can refresh. */
  onChanged?: () => void;
  /** Render inline (full page) instead of as a slide-over. */
  inline?: boolean;
}

export function AlertDrawer({ alertId, onClose, userRole: roleProp, onChanged, inline = false }: AlertDrawerProps) {
  const session = useSessionInfo();
  const userRole = roleProp ?? session?.membership.role ?? "reviewer";
  const [data, setData] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "scoring" | "details" | "notes" | "history">("overview");
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [history, setHistory] = useState<AuditEvent[] | null>(null);
  const [historyRefs, setHistoryRefs] = useState<Refs>({});
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);

  const canEdit = userRole !== "risk_owner";

  const load = useCallback(async () => {
    if (!alertId) return;
    try {
      const res = await fetch(`/api/alerts/${alertId}`);
      if (!res.ok) throw new Error("Failed to load alert");
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alert");
    }
  }, [alertId]);

  useEffect(() => {
    if (!alertId) return;
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    setHistory(null);
    setNotesCount(null);
    setActiveTab("overview");
    load().finally(() => !cancelled && setLoading(false));
    if (canEdit) {
      fetch("/api/teams/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => !cancelled && setMembers(d.members || []));
      fetch("/api/groups").then((r) => (r.ok ? r.json() : { groups: [] })).then((d) => !cancelled && setGroups(d.groups || []));
    }
    return () => {
      cancelled = true;
    };
  }, [alertId, load, canEdit]);

  useEffect(() => {
    if (activeTab !== "history" || !alertId || history) return;
    fetch(`/api/audit?entity_id=${alertId}&limit=50`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => {
        setHistoryRefs(d.refs || {});
        setHistory(d.events || []);
      });
  }, [activeTab, alertId, history]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  // Close on Escape
  useEffect(() => {
    if (inline || !alertId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !scoreOpen && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inline, alertId, scoreOpen, onClose]);

  // Products attached to this alert (confirmed by a person) vs. inherited from its groups
  const directProductKeys = new Set(
    (data?.products || []).filter((p) => p.source === "alert" && p.state !== "suggested").map((p) => p.key)
  );
  const inheritedProducts = new Map(
    (data?.products || []).filter((p) => p.source === "group").map((p) => [p.key, (p.group_path || []).join(" › ")])
  );
  const toggleProduct = async (ref: ProductRef, attach: boolean) => {
    if (!alertId) return;
    await setAlertProduct([alertId], ref, attach);
    await load();
    setHistory(null);
    setFlash({ ok: true, text: attach ? `Attached “${ref.name}”` : `Removed “${ref.name}”` });
    onChanged?.();
  };

  async function mutate(label: string, fn: () => Promise<Response>) {
    setBusy(true);
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${label} failed`);
      await load();
      setHistory(null);
      setFlash({ ok: true, text: label });
      onChanged?.();
      return true;
    } catch (err) {
      setFlash({ ok: false, text: err instanceof Error ? err.message : `${label} failed` });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const assign = (membershipId: string | null) => {
    setAssignOpen(false);
    return mutate(membershipId ? "Owner assigned" : "Owner removed", () =>
      fetch(`/api/alerts/${alertId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(membershipId ? { membership_id: membershipId } : { membership_id: null }),
      })
    );
  };

  const setGroup = async (groupId: string) => {
    setGroupOpen(false);
    return mutate("Added to group", () =>
      fetch(`/api/groups/${groupId}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId }),
      })
    );
  };

  const removeGroup = async () => {
    if (!data?.alert.group_id) return;
    setGroupOpen(false);
    return mutate("Removed from group", () =>
      fetch(`/api/groups/${data.alert.group_id}/alerts?alert_id=${alertId}`, { method: "DELETE" })
    );
  };

  const createAndSetGroup = async (title: string, parentId: string | null) => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const g = await createGroup(title.trim(), parentId);
      await setGroup(g.id);
      const res = await fetch("/api/groups");
      if (res.ok) setGroups((await res.json()).groups || []);
    } catch (err) {
      setFlash({ ok: false, text: err instanceof Error ? err.message : "Could not create group" });
    } finally {
      setBusy(false);
    }
  };

  const saveScore = async (changes: Array<{ target: string; value: number; reason: string }>) => {
    for (const c of changes) {
      const res = await fetch(`/api/alerts/${alertId}/score`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not save score");
      }
    }
    await load();
    setHistory(null);
    setFlash({ ok: true, text: "Score updated" });
    onChanged?.();
  };

  const clearOverride = async (target: string) => {
    const ok = await mutate("Override cleared", () => fetch(`/api/alerts/${alertId}/score?target=${target}`, { method: "DELETE" }));
    if (ok) setScoreOpen(false);
  };

  if (!alertId) return null;

  const band = data?.assessment?.effective_band || "unscored";
  const scoreBand = data?.assessment?.base_band || null;
  const style = BAND_STYLE[band] || BAND_STYLE.unscored;
  const outstanding = (data?.deadlines || []).filter((d) => d.lifecycle_state === "outstanding");
  const nextDeadline = [...outstanding].sort((a, b) => a.date_value.localeCompare(b.date_value))[0];
  const ownerId = data?.alert.ownership.direct_owner_id ?? null;
  const totalOverride = data?.active_overrides.find((o) => o.target === "total") ?? null;

  const scoreFactors = Object.fromEntries(
    FACTORS.map((f) => {
      const src = data?.source_factors.find((s) => s.factor_key === f.key);
      const ov = data?.active_overrides.find((o) => o.target === f.key);
      const eff = data?.assessment ? ((data.assessment as unknown as Record<string, number | null>)[`effective_${f.key}`] ?? null) : null;
      return [f.key, { source: src?.parsed_value ?? null, override: ov?.value ?? null, effective: eff, rationale: src?.rationale || "" }];
    })
  );

  const body = (
    <div className="flex h-full flex-col bg-[var(--background)]">
      {/* Coloured priority strip */}
      <div className={`h-1.5 w-full shrink-0 bg-gradient-to-r ${style.bar}`} />

      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-5 pb-4 pt-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate font-mono text-[11px] text-slate-400">{data?.alert.external_alert_id}</span>
          <div className="flex items-center gap-1">
            {data?.alert.source_url && (
              <a
                href={data.alert.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
              >
                Source <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {!inline && (
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {data && (
          <>
            <h2 className="mt-1 text-lg font-bold leading-snug text-slate-900 dark:text-white">{data.alert.title}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {scoreBand && scoreBand !== band && (
                <>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${(BAND_STYLE[scoreBand] || BAND_STYLE.unscored).chip}`}
                    title="Band from the numeric score alone"
                  >
                    Score: {(BAND_STYLE[scoreBand] || BAND_STYLE.unscored).label}
                  </span>
                  <span className="text-xs text-slate-400" aria-hidden="true">→</span>
                </>
              )}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${style.chip}`}
                title={scoreBand && scoreBand !== band ? "Final priority after escalation rules" : "Priority"}
              >
                {(band === "critical" || band === "high") && <AlertTriangle className="h-3 w-3" />}
                {scoreBand && scoreBand !== band ? `Final: ${style.label}` : style.label}
              </span>
              {data.alert.group_id && data.alert.group_title && (
                <span
                  title={(data.alert.group_path || [data.alert.group_title]).join(" › ")}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30"
                >
                  <Tag className="h-3 w-3 shrink-0" />
                  <span className="truncate">{(data.alert.group_path || [data.alert.group_title]).join(" › ")}</span>
                </span>
              )}
              <StageBadge stage={data.alert.stage} />
            </div>

            {/* Key facts */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  label: "Risk score",
                  value: data.assessment?.effective_total ?? "—",
                  strong: true,
                  sub: data.assessment?.base_band
                    ? `${data.assessment.base_band.charAt(0).toUpperCase()}${data.assessment.base_band.slice(1)} by score${
                        data.assessment.base_band !== data.assessment.effective_band ? " · escalated" : ""
                      }`
                    : undefined,
                },
                {
                  label: "Deadline",
                  value: nextDeadline ? formatDate(nextDeadline.date_value) : "—",
                  sub: nextDeadline ? (nextDeadline.verification_state === "verified" ? "Confirmed" : "Unconfirmed") : undefined,
                },
                {
                  label: data.assessment?.days_remaining != null && data.assessment.days_remaining < 0 ? "Overdue by" : "Days left",
                  value:
                    data.assessment?.days_remaining == null
                      ? "—"
                      : data.assessment.days_remaining < 0
                      ? `${Math.abs(data.assessment.days_remaining)} days`
                      : data.assessment.days_remaining,
                  warn: data.assessment?.days_remaining != null && data.assessment.days_remaining <= 30,
                },
              ].map((f) => (
                <div key={f.label} className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{f.label}</div>
                  <div
                    className={`mt-0.5 truncate text-lg font-bold tabular-nums ${
                      f.warn ? "text-orange-600" : "text-slate-900 dark:text-white"
                    }`}
                  >
                    {String(f.value)}
                  </div>
                  {f.sub && (
                    <div
                      className={`text-[10px] ${
                        f.sub === "Confirmed" ? "text-emerald-600" : f.sub.includes("escalated") ? "text-violet-600 dark:text-violet-300" : "text-amber-600"
                      }`}
                    >
                      {f.sub}
                    </div>
                  )}
                </div>
              ))}

              {/* Owner: shown and changed in one place */}
              {(() => {
                const ownerName = data.alert.ownership.effective_owner_name;
                const ownerAvatar = members.find((m) => m.id === ownerId)?.avatar;
                const viaGroup = !data.alert.ownership.direct_owner_name && !!ownerName;
                const tile = (
                  <>
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Owner
                      {canEdit && <ChevronDown className="h-3 w-3" />}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      {ownerName ? (
                        <UserAvatar name={ownerName} src={ownerAvatar} className="h-6 w-6 shrink-0 text-[9px]" />
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 dark:border-slate-600">
                          <UserPlus className="h-3 w-3" />
                        </span>
                      )}
                      <span className={`truncate text-sm font-semibold ${ownerName ? "text-slate-900 dark:text-white" : "text-slate-500"}`}>
                        {ownerName || (canEdit ? "Assign owner" : "Unassigned")}
                      </span>
                    </div>
                    {viaGroup && <div className="text-[10px] text-slate-500">From its group</div>}
                  </>
                );
                if (!canEdit) return <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">{tile}</div>;
                return (
                <Popover open={assignOpen} onOpenChange={setAssignOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={ownerName ? `Owner: ${ownerName}. Change owner` : "Assign owner"}
                      className={`rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${
                        assignOpen
                          ? "bg-blue-50 ring-blue-300 dark:bg-blue-500/10 dark:ring-blue-500/40"
                          : "bg-slate-50 ring-transparent hover:bg-blue-50/60 hover:ring-blue-200 dark:bg-slate-800/60 dark:hover:bg-blue-500/10 dark:hover:ring-blue-500/30"
                      }`}
                    >
                      {tile}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-1.5">
                    <p className="px-2.5 py-1.5 text-xs font-semibold text-slate-500">Assign to</p>
                    {members.length === 0 && <p className="px-2.5 py-2 text-sm text-slate-500">No team members yet. Invite people from Team.</p>}
                    {members.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => assign(m.id)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <UserAvatar name={m.display_name} src={m.avatar} className="h-7 w-7 text-[10px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.display_name}</span>
                          <span className="block truncate text-xs text-slate-500">{m.email}</span>
                        </span>
                        {ownerId === m.id && <Check className="h-4 w-4 text-blue-600" />}
                      </button>
                    ))}
                    {ownerId && (
                      <button
                        onClick={() => assign(null)}
                        className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-2.5 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-slate-800 dark:hover:bg-red-500/10"
                      >
                        <UserMinus className="h-4 w-4" /> Remove owner
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
                );
              })()}
            </div>

            {/* Actions: one row on desktop, two by two on phones */}
            {canEdit && (
              <div aria-busy={busy} className={`mt-3 grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-4 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                <Popover open={groupOpen} onOpenChange={setGroupOpen}>
                  <PopoverTrigger asChild>
                    <span className="block"><ActionButton icon={FolderPlus} label={data.alert.group_title ? "Change group" : "Add to group"} active={groupOpen} /></span>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-1.5">
                    <GroupPicker
                      groups={groups}
                      selectedId={data.alert.group_id}
                      onPick={(id) => setGroup(id)}
                      onCreate={(t, p) => createAndSetGroup(t, p)}
                    />
                    {data.alert.group_id && (
                      <button onClick={removeGroup} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                        <FolderMinus className="h-4 w-4" /> Remove from group
                      </button>
                    )}
                  </PopoverContent>
                </Popover>

                <Popover open={productsOpen} onOpenChange={setProductsOpen}>
                  <PopoverTrigger asChild>
                    <span className="block"><ActionButton icon={Package} label="Products" active={productsOpen} /></span>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-1.5">
                    <ProductPicker
                      attached={directProductKeys}
                      inherited={inheritedProducts}
                      onToggle={toggleProduct}
                    />
                  </PopoverContent>
                </Popover>

                <ActionButton icon={SlidersHorizontal} label="Adjust score" onClick={() => setScoreOpen(true)} />

                <ActionButton
                  icon={CalendarCheck}
                  label={outstanding.length ? "Deadlines" : "Add deadline"}
                  onClick={() => setDeadlineOpen(true)}
                  active={deadlineOpen}
                />
              </div>
            )}
          </>
        )}

        {flash && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              flash.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
            }`}
            role="status"
          >
            {flash.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {flash.text}
          </div>
        )}

        {/* Tabs */}
        {data && (
          <div className="-mb-4 mt-4 flex gap-1">
            {(["overview", "scoring", "details", "notes", "history"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-700 dark:text-blue-300"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {tab}
                {tab === "notes" && (notesCount ?? data.notes_count ?? 0) > 0 && (
                  <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-px text-[10px] font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    {notesCount ?? data.notes_count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {loading && (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
          </div>
        )}
        {error && !loading && (
          <div className="flex h-64 flex-col items-center justify-center text-red-500">
            <AlertTriangle className="mb-2 h-8 w-8" />
            <p>{error}</p>
          </div>
        )}

        {data && !loading && (
          <div className="space-y-4">
            {activeTab === "overview" && (
              <>
                {data.assessment?.escalation_reasons && data.assessment.escalation_reasons.length > 0 && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50 p-3.5 dark:border-violet-500/30 dark:bg-violet-500/10">
                    <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-violet-800 dark:text-violet-200">
                      <AlertTriangle className="h-4 w-4" /> Escalation applied
                    </div>
                    {data.assessment.escalation_reasons.map((r, i) => (
                      <div key={i} className="text-xs text-violet-700 dark:text-violet-300">{r.description || r.reason}</div>
                    ))}
                  </div>
                )}
                {(data.alert.overview || data.alert.summary) && (
                  <Section title="Summary" icon={FileText}>
                    {data.alert.overview && <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{data.alert.overview}</p>}
                    {data.alert.summary && data.alert.summary !== data.alert.overview && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">{data.alert.summary}</p>
                    )}
                  </Section>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Section title="Geography" icon={Globe2}>
                    <div className="flex flex-wrap gap-1.5">
                      {data.geographies.map((g, i) => (
                        <span key={i} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{g.display_name}</span>
                      ))}
                      {data.geographies.length === 0 && <span className="text-sm text-slate-500">{data.alert.jurisdiction_raw || "—"} <span className="text-xs text-slate-400">(not a country)</span></span>}
                    </div>
                  </Section>
                  <Section title="Products" icon={Package}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {data.products.map((p) => (
                        <ProductChip
                          key={p.key}
                          product={p}
                          onRemove={canEdit && p.source === "alert" ? () => toggleProduct(p, false).catch(() => {}) : undefined}
                        />
                      ))}
                      {data.products.length === 0 && (
                        <span className="text-sm text-slate-500 dark:text-slate-400">No products attached.</span>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setProductsOpen(true)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600 dark:border-slate-600"
                        >
                          + Attach
                        </button>
                      )}
                    </div>
                    {data.alert.product_raw && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        From the import file: <span className="text-slate-700 dark:text-slate-300">{data.alert.product_raw}</span>
                      </p>
                    )}
                  </Section>
                </div>
                {(data.topics.length > 0 || data.tags.length > 0) && (
                  <Section title="Topics" icon={Tag}>
                    <div className="flex flex-wrap gap-1.5">
                      {data.tags.map((t, i) => (
                        <span key={`t${i}`} className="rounded-full border px-2.5 py-1 text-xs font-medium" style={{ borderColor: t.color, color: t.color }}>{t.tag_name}</span>
                      ))}
                      {data.topics.map((t, i) => (
                        <span key={`p${i}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">{t.source_label || t.normalized_key}</span>
                      ))}
                    </div>
                  </Section>
                )}
                <Section title="Ownership" icon={User}>
                  <div className="text-sm">
                    {data.alert.ownership.effective_owner_name ? (
                      <span className="font-medium text-slate-900 dark:text-white">{data.alert.ownership.effective_owner_name}</span>
                    ) : (
                      <span className="text-slate-500">Unassigned</span>
                    )}
                    {data.alert.ownership.type && data.alert.ownership.effective_owner_name && (
                      <span className="ml-2 text-xs capitalize text-slate-400">({data.alert.ownership.type})</span>
                    )}
                  </div>
                </Section>
              </>
            )}

            {activeTab === "scoring" && (
              <>
                <Section title="Factor ratings" icon={SlidersHorizontal}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {FACTORS.map((f) => {
                      const sf = scoreFactors[f.key];
                      return (
                        <div key={f.key} className="rounded-xl border border-slate-200 p-3 text-center dark:border-slate-700">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{f.letter} · {f.label}</div>
                          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{sf.effective ?? "—"}</div>
                          {sf.override != null ? (
                            <div className="text-[11px] font-medium text-blue-600">Adjusted (source {sf.source ?? "—"})</div>
                          ) : (
                            <div className="text-[11px] text-slate-400">From source</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                    <span className="text-slate-500">
                      {totalOverride ? (
                        <>Total set manually <span className="text-xs">(A × B × C = {data.assessment?.raw_total ?? "—"})</span></>
                      ) : (
                        "Market access × Cost × Urgency"
                      )}
                    </span>
                    <span className={`font-bold tabular-nums ${totalOverride ? "text-blue-600" : ""}`}>{data.assessment?.effective_total ?? "—"}</span>
                  </div>
                  {canEdit && (
                    <button onClick={() => setScoreOpen(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline">
                      <SlidersHorizontal className="h-4 w-4" /> Adjust ratings
                    </button>
                  )}
                </Section>
                {data.source_factors.some((f) => f.rationale) && (
                  <Section title="Rationale from source">
                    <dl className="space-y-2 text-sm">
                      {data.source_factors.filter((f) => f.rationale).map((f) => (
                        <div key={f.factor_key}>
                          <dt className="text-xs font-semibold text-slate-500">{FACTORS.find((x) => x.key === f.factor_key)?.label}</dt>
                          <dd className="text-slate-700 dark:text-slate-300">{f.rationale}</dd>
                        </div>
                      ))}
                    </dl>
                  </Section>
                )}
                {data.active_overrides.length > 0 && (
                  <Section title="Active adjustments">
                    <ul className="space-y-2 text-sm">
                      {data.active_overrides.map((o) => (
                        <li key={o.target} className="flex items-start justify-between gap-3">
                          <span>
                            <span className="font-medium">{o.target === "total" ? "Total score" : FACTORS.find((x) => x.key === o.target)?.label}</span> → {o.value}
                            <span className="block text-xs text-slate-500">{o.reason}</span>
                          </span>
                          {canEdit && (
                            <button onClick={() => clearOverride(o.target)} className="shrink-0 text-xs font-medium text-red-600 hover:underline">Clear</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}
                {data.forecast && (
                  <Section title="Implementation forecast" icon={Clock}>
                    <p className="text-sm">{data.forecast.remaining_days} days remaining · finish {formatDate(data.forecast.estimated_finish_date)}</p>
                  </Section>
                )}
              </>
            )}

            {activeTab === "details" && (
              <Section title="Details" icon={Link2}>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {[
                    ["Published", formatDate(data.alert.published_on)],
                    ["Stage", data.alert.stage],
                    ["Timing", data.alert.timing_raw],
                    ["Change type", data.alert.change_type],
                    ["Jurisdiction", data.alert.jurisdiction_raw],
                    ["Agency", data.alert.agency_name],
                    ["Source", data.alert.source_name],
                    ["Recommendation", data.alert.recommendation],
                    ["Relevance", data.alert.relevance],
                  ]
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{k}</dt>
                        <dd className="mt-0.5 text-slate-800 dark:text-slate-200">{v}</dd>
                      </div>
                    ))}
                </dl>
                {data.alert.source_url && (
                  <a href={data.alert.source_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 break-all text-sm text-blue-600 hover:underline">
                    {data.alert.source_url} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                )}
              </Section>
            )}

            {activeTab === "notes" && alertId && (
              <AlertNotes alertId={alertId} isAdmin={userRole === "company_admin"} onCount={setNotesCount} />
            )}

            {activeTab === "history" && (
              <Section title="Activity" icon={History}>
                {!history ? (
                  <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                ) : history.length === 0 ? (
                  <p className="text-sm text-slate-500">No activity recorded yet.</p>
                ) : (
                  <ol className="relative space-y-4 border-l border-slate-200 pl-5 dark:border-slate-700">
                    {history.map((e) => {
                      const d = describeEvent(e, historyRefs);
                      return (
                        <li key={e.id} className="relative">
                          <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-500 dark:border-slate-900" />
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            <span className="font-semibold text-slate-900 dark:text-white">{e.actor_name || "System"}</span>{" "}
                            <Sentence parts={lowerFirst(d.summary)} />
                          </p>
                          <p className="text-xs text-slate-500">{new Date(e.occurred_at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                          {d.note && <p className="mt-0.5 text-xs italic text-slate-600 dark:text-slate-400">“{d.note}”</p>}
                          <ChangeList changes={d.changes} />
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
            )}
          </div>
        )}
      </div>

      {deadlineOpen && data && (
        <DeadlineDialog
          alertId={data.alert.id}
          alertTitle={data.alert.title}
          canEdit={canEdit}
          onClose={() => setDeadlineOpen(false)}
          onChanged={async () => {
            await load();
            setHistory(null);
            onChanged?.();
          }}
        />
      )}

      {scoreOpen && data && (
        <ScoreEditor
          alertId={data.alert.id}
          alertTitle={data.alert.title}
          factors={scoreFactors}
          liveUrgency={data.assessment?.factor_urgency ?? null}
          totalOverride={totalOverride?.value ?? null}
          onSave={saveScore}
          onClearOverride={clearOverride}
          onClose={() => setScoreOpen(false)}
        />
      )}
    </div>
  );

  if (inline) {
    return <div className="panel h-[calc(100vh-8rem)] overflow-hidden">{body}</div>;
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl shadow-2xl animate-in slide-in-from-right">{body}</div>
    </>
  );
}
