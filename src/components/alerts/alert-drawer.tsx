"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X, ExternalLink, Clock, ChevronDown, MapPin, Tag, FileText, AlertTriangle, Loader2,
  SlidersHorizontal, Link2, Package, FolderPlus, Check, UserPlus, UserMinus,
  CalendarCheck, Globe2, History, CheckCircle2, FolderMinus, Layers, Fingerprint, Eye, Undo2,
} from "lucide-react";
import { IDENTIFIER_LABELS, METHOD_LABELS, VERSION_LABELS, type GroupingMethod, type IdentifierKind, type VersionType } from "@/lib/grouping/labels";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScoreEditor } from "@/components/alerts/score-editor";
import { useSessionInfo } from "@/components/layout/session-context";
import { askChangeComment, commentHeader } from "@/components/layout/change-comment";
import { StageBadge, GroupPicker, createGroup, NeedsReviewBadge, setHumanReview, type Group } from "@/components/alerts/alerts-table";
import { DeadlineDialog } from "@/components/alerts/deadline-dialog";
import { AlertNotes } from "@/components/alerts/alert-notes";
import { AlertCountryMapping } from "@/components/alerts/alert-country-mapping";
import { describeEvent, type Refs } from "@/lib/audit-describe";
import { Sentence, ChangeList, lowerFirst } from "@/components/audit/audit-entry";
import { ProductPicker, ProductChip, setAlertProduct, type AttachedProduct, type ProductRef } from "@/components/products/product-picker";
import { UserAvatar } from "@/components/ui/brand";
import { canAssign, canMakeChanges, hasCompanyWideAccess } from "@/lib/auth/permissions";
import { CONFIDENCE_CHOICES, confidenceLevel } from "@/lib/scoring/confidence";

const CONFIDENCE_STYLE = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  medium: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  low: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
  none: "bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700",
} as const;

/** Confidence chip for one factor; editable (with a comment) when onSet is given. */
function ConfidenceControl({
  value, imported, manual, setBy, onSet,
}: {
  value: string | null;
  imported: string | null;
  manual: boolean;
  setBy?: string | null;
  onSet?: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const level = confidenceLevel(value) ?? "none";
  const chip = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${CONFIDENCE_STYLE[level]}`}
      title={manual ? `Set by ${setBy || "a team member"}${imported ? ` · imported: ${imported}` : ""}` : value ? "From the import" : "No confidence given"}
    >
      {value ? `${value} confidence` : "Confidence —"}
      {manual && <span className="font-normal opacity-70">· set</span>}
      {onSet && <ChevronDown className="h-3 w-3 opacity-60" />}
    </span>
  );
  if (!onSet) return chip;
  const pick = (v: string | null) => {
    setOpen(false);
    setCustom("");
    onSet(v);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Change confidence" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {chip}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-56 p-1.5">
        <p className="px-2.5 py-1.5 text-xs font-semibold text-slate-500">Confidence</p>
        {CONFIDENCE_CHOICES.map((c) => (
          <button
            key={c}
            onClick={() => pick(c)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {c}
            {value === c && <Check className="h-4 w-4 text-blue-600" />}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) pick(custom.trim());
          }}
          className="mt-1 flex gap-1.5 border-t border-slate-100 px-1 pt-2 dark:border-slate-800"
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="e.g. 80%"
            aria-label="Confidence percentage"
            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
          <button type="submit" className="rounded-md bg-blue-600 px-2 text-xs font-semibold text-white hover:bg-blue-700">Set</button>
        </form>
        {manual && (
          <button
            onClick={() => pick(null)}
            className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Use imported value{imported ? ` (${imported})` : " (none)"}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

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
    category_user_defined?: string | null;
    key_dates?: string | null;
    date_relevance?: string | null;
    status_summary?: string | null;
    status_details?: string | null;
    timing_summary?: string | null;
    timing_details?: string | null;
    change_summary?: string | null;
    change_details?: string | null;
    source_context?: string | null;
    source_context_summary?: string | null;
    source_context_details?: string | null;
    local_state: string;
    record_version: number;
    group_id: string | null;
    group_title: string | null;
    group_path?: string[] | null;
    version_type?: VersionType | null;
    grouping?: { method: GroupingMethod | null; confidence: number | null; basis: string | null; reviewed: boolean };
    identifiers?: Array<{ kind: IdentifierKind; value: string; source: string }>;
    human_review?: {
      required: boolean;
      reason: string | null;
      from_import: boolean;
      flagged_at: string | null;
      flagged_by_name: string | null;
      cleared_at: string | null;
      cleared_by_name: string | null;
    };
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
  source_factors: Array<{ factor_key: string; original_value: string; parsed_value: number | null; rationale: string; confidence?: string | null }>;
  factor_confidence?: Array<{ factor_key: string; confidence: string; set_at: string; set_by_name: string | null }>;
  active_overrides: Array<{ target: string; value: number; reason: string; expires_at: string | null; previous_value: number | null }>;
  products: AttachedProduct[];
  /** Notes the viewer can see (team notes + their own private ones) */
  notes_count?: number;
  geographies: Array<{ display_name: string; code: string; level: string; state: string; source_evidence: string | null }>;
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

/** One topic from the feed: a label/value, a short summary, and full details behind "More". */
function ContextItem({ title, value, summary, details }: { title: string; value?: string | null; summary?: string | null; details?: string | null }) {
  if (!value && !summary && !details) return null;
  return (
    <div className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0 dark:border-slate-800">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400">{title}</h5>
        {value && <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{value}</span>}
      </div>
      {summary && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{summary}</p>}
      {details && details !== summary && (
        <details className="group mt-1">
          <summary className="cursor-pointer list-none text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            <span className="group-open:hidden">Show details</span>
            <span className="hidden group-open:inline">Hide details</span>
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600 dark:text-slate-400">{details}</p>
        </details>
      )}
    </div>
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

/** Family › Action › Version, how the alert got there, and the identifiers found on it. */
function GroupingDetails({
  alert,
  canReview,
  busy,
  onReview,
}: {
  alert: AlertDetail["alert"];
  canReview: boolean;
  busy: boolean;
  onReview: (d: "confirm" | "reject") => void;
}) {
  const g = alert.grouping;
  const path = alert.group_path || (alert.group_title ? [alert.group_title] : []);
  const pending = (g?.method === "similarity" || g?.method === "ai") && !g.reviewed;
  const ids = alert.identifiers || [];
  return (
    <div className="space-y-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {path.length ? (
          path.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-300">›</span>}
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${i === 0 ? "bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>{p}</span>
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-500">Not in a regulatory family yet</span>
        )}
        {alert.version_type && (
          <>
            <span className="text-slate-300">›</span>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" title="Version type (level 3)">
              {VERSION_LABELS[alert.version_type] ?? alert.version_type}
            </span>
          </>
        )}
      </div>
      {path.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {g?.method ? METHOD_LABELS[g.method] : "Grouped before automatic grouping"}
            {g?.confidence ? ` · ${g.confidence}% confidence` : ""}
          </span>
          {g?.basis && <> — {g.basis}</>}
        </p>
      )}
      {!path.length && g?.method === "manual" && g.basis && (
        <p className="text-xs text-slate-600 dark:text-slate-400">Removed from automatic grouping by hand — {g.basis}</p>
      )}
      {pending && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5" /> Grouped by similar subject — needs a person to confirm.
          {canReview && (
            <span className="ml-auto flex gap-1.5">
              <button type="button" disabled={busy} onClick={() => onReview("confirm")} className="rounded-md bg-white px-2 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-50 dark:bg-slate-900">Confirm</button>
              <button type="button" disabled={busy} onClick={() => onReview("reject")} className="rounded-md bg-white px-2 py-1 font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50 dark:bg-slate-900">Reject</button>
            </span>
          )}
        </div>
      )}
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Fingerprint className="h-3.5 w-3.5 text-slate-400" aria-label="Identifiers" />
          {ids.map((i) => (
            <span key={`${i.kind}:${i.value}`} className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300" title={IDENTIFIER_LABELS[i.kind]}>
              <span className="font-sans font-semibold text-slate-500">{IDENTIFIER_LABELS[i.kind]}</span> {i.kind === "bill" ? i.value.split(" ").slice(1).join(" ") : i.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface AlertDrawerProps {
  alertId: string | null;
  onClose: () => void;
  userRole?: string;
  /** Called after a change so lists and dashboard summaries can refresh. */
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

  // Reviewers and risk owners can only look
  const canEdit = canMakeChanges(userRole);
  const canAssignOwner = canAssign(userRole);
  const canGroup = hasCompanyWideAccess(userRole, session?.membership.access_scope ?? "");
  const canViewHistory = userRole !== "risk_owner";

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
    if (canAssignOwner) {
      fetch("/api/teams/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => !cancelled && setMembers(d.members || []));
    }
    if (canGroup) {
      fetch("/api/groups").then((r) => (r.ok ? r.json() : { groups: [] })).then((d) => !cancelled && setGroups(d.groups || []));
    }
    return () => {
      cancelled = true;
    };
  }, [alertId, load, canAssignOwner, canGroup]);

  useEffect(() => {
    if (!canViewHistory || activeTab !== "history" || !alertId || history) return;
    fetch(`/api/audit?entity_id=${alertId}&limit=50`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => {
        setHistoryRefs(d.refs || {});
        setHistory(d.events || []);
      });
  }, [activeTab, alertId, canViewHistory, history]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  // Close on Escape
  useEffect(() => {
    if (inline || !alertId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && !scoreOpen && onClose();
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
    if (!(await setAlertProduct([alertId], ref, attach))) return;
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

  const changeReview = async (flag: boolean, revert = false) => {
    if (!alertId) return;
    const comment = await askChangeComment({
      action: revert ? (flag ? "Revert: mark Needs review again" : "Revert: mark reviewed again") : flag ? "Mark Needs review" : "Mark reviewed",
      detail: flag ? "Say what needs checking" : "Say what you checked",
    });
    if (!comment) return;
    setBusy(true);
    try {
      await setHumanReview([alertId], flag, comment, revert);
      await load();
      setHistory(null);
      setNotesCount(null);
      setFlash({ ok: true, text: flag ? "Flagged for review" : "Marked reviewed" });
      onChanged?.();
    } catch (err) {
      setFlash({ ok: false, text: err instanceof Error ? err.message : "Could not update review status" });
    } finally {
      setBusy(false);
    }
  };

  const setConfidence = async (factorKey: string, label: string, value: string | null, revert = false) => {
    if (!alertId) return;
    const comment = await askChangeComment({
      action: `${revert ? "Revert: " : ""}${value ? `Set ${label} confidence to ${value}` : `Reset ${label} confidence to the imported value`}`,
    });
    if (!comment) return;
    await mutate(value ? "Confidence updated" : "Confidence reset", () =>
      fetch(`/api/alerts/${alertId}/confidence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factor_key: factorKey, confidence: value, comment, ...(revert ? { revert: true } : {}) }),
      })
    );
  };

  const assign = async (membershipId: string | null) => {
    setAssignOpen(false);
    const who = members.find((m) => m.id === membershipId)?.display_name;
    const comment = await askChangeComment({ action: membershipId ? `Assign owner: ${who ?? "team member"}` : "Remove owner" });
    if (!comment) return;
    return mutate(membershipId ? "Owner assigned" : "Owner removed", () =>
      fetch(`/api/alerts/${alertId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId, comment }),
      })
    );
  };

  const setGroup = async (groupId: string, knownComment?: string) => {
    setGroupOpen(false);
    const g = groups.find((x) => x.id === groupId);
    const comment = knownComment ?? (await askChangeComment({
      action: `Move to group ${g ? (g.path || [g.title]).join(" › ") : ""}`,
      detail: "Recorded as the basis for this grouping; automatic grouping won't move it again",
    }));
    if (!comment) return;
    return mutate("Added to group", () =>
      fetch(`/api/groups/${groupId}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId, comment }),
      })
    );
  };

  const removeGroup = async () => {
    if (!data?.alert.group_id) return;
    setGroupOpen(false);
    const comment = await askChangeComment({
      action: `Remove from group ${(data.alert.group_path || [data.alert.group_title]).join(" › ")}`,
      detail: "Automatic grouping won't put it back",
    });
    if (!comment) return;
    return mutate("Removed from group", () =>
      fetch(`/api/groups/${data.alert.group_id}/alerts?alert_id=${alertId}`, { method: "DELETE", headers: commentHeader(comment) })
    );
  };

  const createAndSetGroup = async (title: string, parentId: string | null) => {
    if (!title.trim()) return;
    const comment = await askChangeComment({ action: `Create group “${title.trim()}” and move this alert into it`, detail: "Recorded as the basis for this grouping" });
    if (!comment) return;
    setBusy(true);
    try {
      const g = await createGroup(title.trim(), parentId);
      await setGroup(g.id, comment);
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

  /** Confirm or reject a grouping made by subject similarity. */
  const reviewGrouping = async (decision: "confirm" | "reject") => {
    const path = (data?.alert.group_path || []).join(" › ");
    const comment = await askChangeComment({
      action: decision === "confirm" ? `Confirm automatic grouping into ${path}` : `Reject automatic grouping — remove from ${path}`,
    });
    if (!comment) return;
    return mutate(decision === "confirm" ? "Grouping confirmed" : "Removed from group", () =>
      fetch("/api/groups/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId, decision, comment }),
      })
    );
  };

  const targetName = (t: string) => (t === "total" ? "Total score" : FACTORS.find((x) => x.key === t)?.label ?? t.replace(/_/g, " "));

  /**
   * Steps a score back one change: the previous adjustment comes back, or the imported value
   * when there was none. Repeat to walk back to the imported value. "restore" brings back an
   * adjustment that was removed.
   */
  const stepBack = async (target: string, mode: "undo" | "restore" = "undo") => {
    const name = targetName(target);
    const ov = data?.active_overrides.find((o) => o.target === target);
    const to = mode === "restore"
      ? "the adjustment that was removed"
      : ov?.previous_value != null ? `the previous adjustment (${ov.previous_value})` : "the imported value";
    const comment = await askChangeComment({
      action: mode === "restore" ? `Restore the ${name} adjustment` : `Undo the last ${name} change`,
      detail: `${name} goes back to ${to}`,
    });
    if (!comment) return false;
    return mutate(mode === "restore" ? "Adjustment restored" : "Change undone", () =>
      fetch(`/api/alerts/${alertId}/score/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, mode, comment }),
      })
    );
  };

  const clearOverride = async (target: string) => {
    const ok = await stepBack(target);
    if (ok) setScoreOpen(false);
  };

  /** Puts the owner back to who it was before a change. */
  const revertOwner = async (ownerId: string | null) => {
    const who = ownerId ? members.find((m) => m.id === ownerId)?.display_name ?? historyRefs[ownerId]?.name ?? "the previous owner" : null;
    const comment = await askChangeComment({ action: who ? `Revert owner to ${who}` : "Revert to no owner" });
    if (!comment) return;
    return mutate("Owner reverted", () =>
      fetch(`/api/alerts/${alertId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: ownerId, comment, revert: true }),
      })
    );
  };

  /**
   * History: per kind of change (a score factor, the owner, a confidence, the review flag) the
   * changes form a stack — each revert cancels the newest change not reverted yet. The top one can
   * be reverted while it is still the current value, so changes go back one step at a time
   * (reverting never just flips back and forth).
   */
  const revertActions = new Map<string, () => unknown>();
  if (canEdit && data && history) {
    const stacks = new Map<string, Array<{ id: string; run: (() => unknown) | null }>>();
    for (const e of [...history].reverse()) {
      const a = (e.after_values || {}) as Record<string, unknown>;
      const b = (e.before_values || {}) as Record<string, unknown>;
      let key: string | null = null;
      let run: (() => unknown) | null = null;
      if (e.action.startsWith("score_override")) {
        const t = String(a.target ?? b.target ?? "");
        key = `score:${t}`;
        const cur = data.active_overrides.find((o) => o.target === t)?.value ?? null;
        const after = e.action === "score_override_cleared" || a.value == null ? null : Number(a.value);
        if (cur === after) run = () => stepBack(t, cur == null ? "restore" : "undo");
        if (e.action === "score_override_reverted" || e.action === "score_override_restored") {
          stacks.get(key)?.pop();
          continue;
        }
      } else if (e.action === "assign_owner" && e.entity_type === "alert") {
        key = "owner";
        if ((data.alert.ownership.direct_owner_id ?? null) === ((a.owner as string | null) ?? null)) run = () => revertOwner((b.owner as string | null) ?? null);
      } else if (e.action === "factor_confidence_set") {
        const fk = String(a.factor_key ?? b.factor_key ?? "");
        key = `confidence:${fk}`;
        const cur = data.factor_confidence?.find((c) => c.factor_key === fk)?.confidence ?? null;
        if (cur === ((a.confidence as string | null) ?? null)) run = () => setConfidence(fk, targetName(fk), (b.confidence as string | null) ?? null, true);
      } else if (e.action === "human_review_flagged" || e.action === "human_review_cleared") {
        key = "review";
        if (!!data.alert.human_review?.required === !!a.human_review_required) run = () => changeReview(!!b.human_review_required, true);
      }
      if (!key) continue;
      const stack = stacks.get(key) ?? [];
      stacks.set(key, stack);
      if (a.reverted_change) stack.pop();
      else stack.push({ id: e.id, run });
    }
    for (const stack of stacks.values()) {
      const top = stack[stack.length - 1];
      if (top?.run) revertActions.set(top.id, top.run);
    }
  }

  if (!alertId) return null;

  const band = data?.assessment?.effective_band || "unscored";
  const scoreBand = data?.assessment?.base_band || null;
  const style = BAND_STYLE[band] || BAND_STYLE.unscored;
  const outstanding = (data?.deadlines || []).filter((d) => d.lifecycle_state === "outstanding");
  const nextDeadline = [...outstanding].sort((a, b) => a.date_value.localeCompare(b.date_value))[0];
  const ownerId = data?.alert.ownership.direct_owner_id ?? null;
  const totalOverride = data?.active_overrides.find((o) => o.target === "total") ?? null;
  // Countries and whole continents (level "region"), continents first
  const mappedCountries = (data?.geographies.filter((g) => (g.level === "country" || g.level === "region") && g.state !== "rejected") ?? [])
    .sort((a, b) => Number(b.level === "region") - Number(a.level === "region") || a.display_name.localeCompare(b.display_name));
  const hasManualMapping = mappedCountries.some((g) => g.state === "confirmed" && g.source_evidence === "manual");

  const scoreFactors = Object.fromEntries(
    FACTORS.map((f) => {
      const src = data?.source_factors.find((s) => s.factor_key === f.key);
      const ov = data?.active_overrides.find((o) => o.target === f.key);
      const eff = data?.assessment ? ((data.assessment as unknown as Record<string, number | null>)[`effective_${f.key}`] ?? null) : null;
      const manualConf = data?.factor_confidence?.find((c) => c.factor_key === f.key);
      return [f.key, {
        source: src?.parsed_value ?? null, override: ov?.value ?? null, effective: eff, rationale: src?.rationale || "",
        importedConfidence: src?.confidence ?? null,
        confidence: manualConf?.confidence ?? src?.confidence ?? null,
        confidenceManual: !!manualConf,
        confidenceSetBy: manualConf?.set_by_name ?? null,
      }];
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
              {data.alert.human_review?.required && <NeedsReviewBadge reason={data.alert.human_review.reason} className="py-1" />}
              {canEdit && data.alert.human_review && !data.alert.human_review.required && (
                <button
                  type="button"
                  onClick={() => changeReview(true)}
                  disabled={busy}
                  className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-500/10 dark:hover:text-amber-300"
                >
                  <Eye className="h-3 w-3" /> Flag for review
                </button>
              )}
            </div>

            {data.alert.human_review?.required && (
              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center dark:border-amber-500/30 dark:bg-amber-500/10">
                <Eye className="hidden h-5 w-5 shrink-0 text-amber-600 sm:block dark:text-amber-300" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">Needs human review</p>
                  <p className="mt-0.5 break-words text-amber-800/90 dark:text-amber-200/80">
                    {data.alert.human_review.reason
                      ? data.alert.human_review.reason
                      : data.alert.human_review.from_import
                      ? "The import file marked this alert for a person to check."
                      : "Flagged for a person to check."}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/70">
                    {data.alert.human_review.from_import ? "From the import (needs_human_review)" : `Flagged by ${data.alert.human_review.flagged_by_name || "a team member"}`}
                    {data.alert.human_review.flagged_at && ` · ${formatDate(data.alert.human_review.flagged_at)}`}
                  </p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => changeReview(false)}
                    disabled={busy}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
                  >
                    <Check className="h-4 w-4" /> Mark reviewed
                  </button>
                )}
              </div>
            )}

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
                      {canAssignOwner && <ChevronDown className="h-3 w-3" />}
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
                        {ownerName || (canAssignOwner ? "Assign owner" : "Unassigned")}
                      </span>
                    </div>
                    {viaGroup && <div className="text-[10px] text-slate-500">From its group</div>}
                  </>
                );
                if (!canAssignOwner) return <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">{tile}</div>;
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
                {canGroup && <Popover open={groupOpen} onOpenChange={setGroupOpen}>
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
                </Popover>}

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
            {(["overview", "scoring", "details", "notes", "history"] as const).filter((tab) => tab !== "history" || canViewHistory).map((tab) => (
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
                <Section title="Regulatory grouping" icon={Layers}>
                  <GroupingDetails
                    alert={data.alert}
                    canReview={canGroup && canEdit}
                    busy={busy}
                    onReview={reviewGrouping}
                  />
                </Section>
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
                {(data.alert.overview || data.alert.summary) && (
                  <Section title="Summary" icon={FileText}>
                    {data.alert.overview && <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{data.alert.overview}</p>}
                    {data.alert.summary && data.alert.summary !== data.alert.overview && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">{data.alert.summary}</p>
                    )}
                  </Section>
                )}
                {(data.alert.status_summary || data.alert.status_details || data.alert.timing_summary || data.alert.timing_details ||
                  data.alert.change_summary || data.alert.change_details || data.alert.source_context || data.alert.source_context_summary ||
                  data.alert.source_context_details || data.alert.key_dates || data.alert.date_relevance) && (
                  <Section title="From the source" icon={FileText}>
                    <div className="space-y-3">
                      <ContextItem title="Status" value={data.alert.stage} summary={data.alert.status_summary} details={data.alert.status_details} />
                      <ContextItem title="Timing" value={data.alert.timing_raw} summary={data.alert.timing_summary} details={data.alert.timing_details} />
                      <ContextItem title="Change" value={data.alert.change_type} summary={data.alert.change_summary} details={data.alert.change_details} />
                      <ContextItem title="Key dates" value={null} summary={data.alert.key_dates} details={data.alert.date_relevance} />
                      <ContextItem title="Source context" value={data.alert.source_context} summary={data.alert.source_context_summary} details={data.alert.source_context_details} />
                    </div>
                  </Section>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Section title="Geography" icon={Globe2}>
                    {data.alert.jurisdiction_raw && (mappedCountries.length === 0 || hasManualMapping) && (
                      <p className="mb-2 text-xs text-[var(--muted-foreground)]">
                        <span className="font-medium">Imported jurisdiction:</span> {data.alert.jurisdiction_raw}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {mappedCountries.map((g) => {
                        const manual = g.state === "confirmed" && g.source_evidence === "manual";
                        return manual ? (
                          <span
                            key={g.code}
                            title={`${g.display_name} — mapped manually by your team`}
                            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30"
                          >
                            <MapPin className="h-3 w-3" aria-hidden /> {g.display_name}
                            <span className="sr-only">(mapped manually)</span>
                          </span>
                        ) : (
                          <span
                            key={g.code}
                            title={`${g.display_name} — from the import file`}
                            className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {g.display_name}
                          </span>
                        );
                      })}
                      {mappedCountries.length === 0 && <span className="text-sm text-slate-500">No location mapped.</span>}
                      {/* Edit sits at the end of the locations */}
                      {session && canEdit && mappedCountries.length > 0 && (
                        <AlertCountryMapping
                          alertId={data.alert.id}
                          alertTitle={data.alert.title}
                          jurisdiction={data.alert.jurisdiction_raw}
                          editing
                          compact
                          onSaved={(text) => {
                            void load();
                            setHistory(null);
                            setFlash({ ok: true, text });
                            onChanged?.();
                          }}
                        />
                      )}
                    </div>
                    {mappedCountries.length > 0 && (
                      <p className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" /> From import</span>
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-blue-600 dark:text-blue-400" aria-hidden /> Mapped manually</span>
                      </p>
                    )}
                    {session && canEdit && mappedCountries.length === 0 && (
                      <div className="mt-2">
                        <AlertCountryMapping
                          alertId={data.alert.id}
                          alertTitle={data.alert.title}
                          jurisdiction={data.alert.jurisdiction_raw}
                          editing={hasManualMapping}
                          onSaved={(text) => {
                            void load();
                            setHistory(null);
                            setFlash({ ok: true, text });
                            onChanged?.();
                          }}
                        />
                      </div>
                    )}
                  </Section>
                  <Section title="Products" icon={Package}>
                    {data.alert.product_raw && (
                      <p className="mb-3 break-words text-sm font-semibold text-slate-700 dark:text-slate-200">
                        From the import file: <strong className="text-slate-950 dark:text-white">{data.alert.product_raw}</strong>
                      </p>
                    )}
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
                  </Section>
                </div>
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
                          <div className="mt-2">
                            <ConfidenceControl
                              value={sf.confidence}
                              imported={sf.importedConfidence}
                              manual={sf.confidenceManual}
                              setBy={sf.confidenceSetBy}
                              onSet={canEdit ? (v) => setConfidence(f.key, f.label, v) : undefined}
                            />
                          </div>
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
                            <button
                              onClick={() => stepBack(o.target)}
                              disabled={busy}
                              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
                              title="Undo this change. Repeat to go back one change at a time, until the imported value."
                            >
                              <Undo2 className="h-3.5 w-3.5" /> Step back to{" "}
                              {o.previous_value != null
                                ? o.previous_value
                                : o.target === "total"
                                  ? `calculated (${data.assessment?.raw_total ?? "—"})`
                                  : `imported (${scoreFactors[o.target]?.source ?? "—"})`}
                            </button>
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
                    ["Category (user)", data.alert.category_user_defined],
                    ["Key dates", data.alert.key_dates],
                    ["Date relevance", data.alert.date_relevance],
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
                  <>
                  {canEdit && (
                    <p className="mb-4 text-xs text-[var(--muted-foreground)]">
                      Changes are reverted one step at a time: the newest change to a score, the owner, a confidence or the review flag can be reverted. Older ones can be reverted after that.
                    </p>
                  )}
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
                          {revertActions.has(e.id) && (
                            <button
                              onClick={() => revertActions.get(e.id)?.()}
                              disabled={busy}
                              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
                            >
                              <Undo2 className="h-3.5 w-3.5" /> Revert this change
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  </>
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
