"use client";

import { useEffect, useState } from "react";
import {
  MoreHorizontal, Eye, UserPlus, Tag, Check, ChevronUp, ChevronDown, Loader2, X, Plus, CalendarClock, AlertTriangle, Trash2, ArrowUp, CalendarPlus, Package,
} from "lucide-react";
import { DeadlineDialog } from "@/components/alerts/deadline-dialog";
import { AlertCountryMapping } from "@/components/alerts/alert-country-mapping";
import { AlertProductsPicker, BulkProductsPicker } from "@/components/products/product-picker";
import { UserAvatar } from "@/components/ui/brand";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog, deleteAlertsRequest } from "@/components/alerts/confirm-dialog";
import { useSessionInfo } from "@/components/layout/session-context";
import { canAssign, hasCompanyWideAccess } from "@/lib/auth/permissions";

export interface AlertRow {
  id: string;
  external_alert_id: string;
  title: string;
  stage: string | null;
  jurisdiction_raw: string | null;
  product_raw: string | null;
  next_compliance_deadline: string | null;
  days_remaining: number | null;
  effective_total: number | null;
  effective_priority: string | null;
  group_id?: string | null;
  group_title?: string | null;
  group_path?: string[] | null;
  owner_membership_id?: string | null;
  owner_name: string | null;
  owner_avatar?: string | null;
  geographies?: string[];
  /** Band from the numeric score alone (before escalation rules). */
  score_band?: string | null;
  escalation_reasons?: Array<{ description: string; resulting_band: string }> | null;
}

interface Member { id: string; display_name: string; email: string; avatar?: string | null }
export interface Group {
  id: string;
  title: string;
  parent_group_id?: string | null;
  depth?: number;
  path?: string[];
  total_count?: number;
}

/** Groups can nest this many levels (group › sub › sub-sub › level 4). */
export const MAX_GROUP_DEPTH = 4;

const PRIORITY: Record<string, { label: string; edge: string; chip: string; bar: string }> = {
  critical: { label: "Critical", edge: "bg-violet-500", chip: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30", bar: "bg-violet-500" },
  high: { label: "High", edge: "bg-orange-500", chip: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30", bar: "bg-orange-500" },
  moderate: { label: "Moderate", edge: "bg-amber-400", chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30", bar: "bg-amber-400" },
  low: { label: "Low", edge: "bg-teal-400", chip: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30", bar: "bg-teal-400" },
  unscored: { label: "Unscored", edge: "bg-slate-300", chip: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600", bar: "bg-slate-300" },
};

// Stable colour per group label
const GROUP_COLORS = [
  "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30",
  "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30",
  "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:ring-fuchsia-500/30",
  "bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30",
];
export function groupColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

/**
 * Group label. With a path (e.g. ["EU", "REACH", "Annex XVII"]) it shows the
 * immediate parent faded before the group name; the full path is in the tooltip.
 * The colour follows the top-level group so a whole family shares one colour.
 */
export function GroupLabel({
  id,
  title,
  path,
  colorKey,
  onClick,
}: {
  id: string;
  title: string;
  path?: string[] | null;
  colorKey?: string;
  onClick?: () => void;
}) {
  const full = path && path.length ? path : [title];
  const parent = full.length > 1 ? full[full.length - 2] : null;
  return (
    <span
      onClick={onClick}
      title={full.join(" › ")}
      className={`inline-flex max-w-[240px] items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${groupColor(colorKey || full[0] || id)} ${onClick ? "cursor-pointer hover:opacity-80" : ""}`}
    >
      <Tag className="h-3 w-3 shrink-0" />
      {parent && (
        <>
          <span className="max-w-[90px] shrink truncate opacity-60">
            {full.length > 2 ? "… › " : ""}
            {parent}
          </span>
          <span className="shrink-0 opacity-60">›</span>
        </>
      )}
      <span className="truncate">{full[full.length - 1]}</span>
    </span>
  );
}

/** Colour-coded regulatory stage, matched on keywords so any feed wording works. */
const STAGE_STYLES: Array<{ match: RegExp; cls: string; dot: string }> = [
  { match: /final|mandatory|adopted|enacted|in force|effective/i, cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30", dot: "bg-rose-500" },
  { match: /consult|comment|open/i, cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30", dot: "bg-sky-500" },
  { match: /draft|propos/i, cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30", dot: "bg-amber-500" },
  { match: /signal|information|notice/i, cls: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600", dot: "bg-slate-400" },
  { match: /withdraw|repeal|expired|closed/i, cls: "bg-zinc-100 text-zinc-500 ring-zinc-200 line-through dark:bg-zinc-700/40 dark:text-zinc-400 dark:ring-zinc-600", dot: "bg-zinc-400" },
  { match: /guid|voluntary|standard/i, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30", dot: "bg-emerald-500" },
];
export function StageBadge({ stage }: { stage: string | null | undefined }) {
  if (!stage) return null;
  const s = STAGE_STYLES.find((x) => x.match.test(stage)) || {
    cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30",
    dot: "bg-violet-500",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {stage}
    </span>
  );
}

function DeadlineCell({ date, days }: { date: string | null; days: number | null }) {
  if (!date) return <span className="text-xs text-slate-400">No deadline</span>;
  // Date-only values ("YYYY-MM-DD") are calendar dates: parse them as local, not UTC
  const d = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  const label = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  let pill = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  let text = days != null ? `${days}d left` : "";
  if (days != null && days < 0) {
    pill = "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
    text = `${Math.abs(days)}d overdue`;
  } else if (days != null && days <= 30) pill = "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300";
  else if (days != null && days <= 180) pill = "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  return (
    <div className="whitespace-nowrap">
      <div className="text-[13px] text-slate-800 dark:text-slate-200">{label}</div>
      {text && <span className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold ${pill}`}>{text}</span>}
    </div>
  );
}

/** Loads team members and groups once for the action menus. */
export function useAssignables(loadMembers = true, loadGroups = loadMembers) {
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(() => {
    if (loadMembers) {
      fetch("/api/teams/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => setMembers(d.members || []));
    }
    if (loadGroups) {
      fetch("/api/groups").then((r) => (r.ok ? r.json() : { groups: [] })).then((d) => setGroups(d.groups || []));
    }
  }, [loadMembers, loadGroups]);
  return { members, groups, setGroups };
}

export async function assignAlerts(ids: string[], membershipId: string | null) {
  for (const id of ids) {
    const res = await fetch(`/api/alerts/${id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membership_id: membershipId }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Assignment failed");
  }
}

export async function groupAlerts(ids: string[], groupId: string) {
  for (const id of ids) {
    const res = await fetch(`/api/groups/${groupId}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_id: id }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Grouping failed");
  }
}

export async function createGroup(title: string, parentId: string | null = null): Promise<Group> {
  const res = await fetch("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, parent_group_id: parentId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Could not create group");
  return body.group;
}

/* ---------- Pickers used by row menu and bulk bar ---------- */

export function MemberPicker({ members, selectedId, onPick }: { members: Member[]; selectedId?: string | null; onPick: (id: string | null) => void }) {
  return (
    <div>
      <p className="px-2.5 py-1.5 text-xs font-semibold text-slate-500">Assign to</p>
      {members.length === 0 && <p className="px-2.5 py-2 text-sm text-slate-500">No team members yet.</p>}
      {members.map((m) => (
        <button key={m.id} onClick={() => onPick(m.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
          <UserAvatar name={m.display_name} src={m.avatar} className="h-7 w-7 text-[10px]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{m.display_name}</span>
            <span className="block truncate text-xs text-slate-500">{m.email}</span>
          </span>
          {selectedId === m.id && <Check className="h-4 w-4 text-blue-600" />}
        </button>
      ))}
      <button onClick={() => onPick(null)} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
        <X className="h-4 w-4" /> Unassign
      </button>
    </div>
  );
}

export function GroupPicker({
  groups,
  selectedId,
  onPick,
  onCreate,
}: {
  groups: Group[];
  selectedId?: string | null;
  onPick: (id: string) => void;
  onCreate: (title: string, parentId: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const parent = parentId ? groups.find((g) => g.id === parentId) : null;
  const pathOf = (g: Group) => g.path || [g.title];
  const shown = q.trim()
    ? groups.filter((g) => pathOf(g).join(" ").toLowerCase().includes(q.trim().toLowerCase()))
    : groups;
  return (
    <div>
      <p className="px-2.5 py-1.5 text-xs font-semibold text-slate-500">Add to group</p>
      {groups.length > 8 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search groups…"
          className="mb-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
      )}
      <div className="max-h-64 overflow-y-auto">
        {groups.length === 0 && <p className="px-2.5 py-2 text-sm text-slate-500">No groups yet — create one below.</p>}
        {shown.map((g) => {
          const depth = g.depth || 1;
          const searching = !!q.trim();
          return (
            <div key={g.id} className="group/row flex items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
              <button
                onClick={() => onPick(g.id)}
                style={{ paddingLeft: searching ? 10 : 10 + (depth - 1) * 16 }}
                className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-1 text-left text-sm"
              >
                {depth > 1 && !searching && <span className="-ml-1 text-slate-300 dark:text-slate-600">└</span>}
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${groupColor(pathOf(g)[0])}`} />
                <span className={`flex-1 truncate ${depth === 1 ? "font-medium" : ""}`}>
                  {searching && pathOf(g).length > 1 && <span className="text-slate-400">{pathOf(g).slice(0, -1).join(" › ")} › </span>}
                  {g.title}
                </span>
                {selectedId === g.id && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
              </button>
              {depth < MAX_GROUP_DEPTH && (
                <button
                  type="button"
                  onClick={() => setParentId(g.id)}
                  title={`New sub-group in ${g.title}`}
                  aria-label={`New sub-group in ${g.title}`}
                  className="mr-1 rounded-md p-1 text-slate-400 opacity-0 hover:bg-white hover:text-blue-600 focus:opacity-100 group-hover/row:opacity-100 dark:hover:bg-slate-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {groups.length > 0 && shown.length === 0 && <p className="px-2.5 py-2 text-sm text-slate-500">No matching groups.</p>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(name.trim(), parentId);
          setName("");
          setParentId(null);
        }}
        className="mt-1 border-t border-slate-100 p-1.5 pt-2.5 dark:border-slate-800"
      >
        {parent && (
          <div className="mb-1.5 flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
            <span className="shrink-0">Inside:</span>
            <span className="min-w-0 flex-1 truncate font-medium">{pathOf(parent).join(" › ")}</span>
            <button type="button" onClick={() => setParentId(null)} aria-label="Create at top level instead" className="rounded p-0.5 hover:bg-blue-100 dark:hover:bg-blue-500/20">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={parent ? "New sub-group name" : "New group name"}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
          />
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-blue-600 px-2.5 text-white disabled:opacity-40" aria-label="Create group">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {!parent && groups.length > 0 && (
          <p className="mt-1 px-0.5 text-[10px] text-slate-400">Tip: hover a group and press + to create a sub-group inside it.</p>
        )}
      </form>
    </div>
  );
}

/* ---------- Table ---------- */

function SortHead({
  col,
  children,
  className = "",
  sortBy,
  sortDir,
  onSort,
}: {
  col?: string;
  children: React.ReactNode;
  className?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  onSort?: (col: string) => void;
}) {
  return (
    <th
      onClick={col && onSort ? () => onSort(col) : undefined}
      className={`px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 ${col && onSort ? "cursor-pointer select-none hover:text-slate-800 dark:hover:text-slate-200" : ""} ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {col && sortBy === col && (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}

interface AlertsTableProps {
  alerts: AlertRow[];
  loading?: boolean;
  onOpen: (id: string) => void;
  onChanged?: () => void;
  selectable?: boolean;
  compact?: boolean;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  onSort?: (col: string) => void;
  onGroupClick?: (groupId: string) => void;
  canEdit?: boolean;
  /** Admins and managers may delete alerts. */
  canDelete?: boolean;
  emptyMessage?: React.ReactNode;
}

export function AlertsTable({
  alerts,
  loading,
  onOpen,
  onChanged,
  selectable = false,
  compact = false,
  sortBy,
  sortDir,
  onSort,
  onGroupClick,
  canEdit = true,
  canDelete = false,
  emptyMessage,
}: AlertsTableProps) {
  const session = useSessionInfo();
  const role = session?.membership.role ?? "";
  const canAssignOwner = canEdit && canAssign(role);
  const canGroup = canEdit && hasCompanyWideAccess(role, session?.membership.access_scope ?? "");
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [ownerFor, setOwnerFor] = useState<string | null>(null);
  const [deadlineFor, setDeadlineFor] = useState<{ id: string; title: string } | null>(null);
  const { members, groups, setGroups } = useAssignables(canAssignOwner, canGroup);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<{ id: string; view: "menu" | "assign" | "group" | "products" } | null>(null);
  const [bulk, setBulk] = useState<"assign" | "group" | "products" | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(t);
  }, [message]);

  // Drop selections that are no longer on the page
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => alerts.some((a) => a.id === id)))); // eslint-disable-line react-hooks/set-state-in-effect
  }, [alerts]);

  const maxScore = Math.max(1, ...alerts.map((a) => a.effective_total ?? 0));
  const allSelected = alerts.length > 0 && alerts.every((a) => selected.has(a.id));

  async function run(label: string, fn: () => Promise<void>) {
    setWorking(true);
    try {
      await fn();
      setMessage({ ok: true, text: label });
      onChanged?.();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setWorking(false);
      setMenuFor(null);
      setBulk(null);
    }
  }

  const doAssign = (ids: string[], memberId: string | null) =>
    run(memberId ? `Assigned ${ids.length} alert${ids.length > 1 ? "s" : ""}` : "Owner removed", async () => {
      await assignAlerts(ids, memberId);
      setSelected(new Set());
    });

  const doGroup = (ids: string[], groupId: string) => {
    const g = groups.find((x) => x.id === groupId);
    const title = g ? (g.path || [g.title]).join(" › ") : "group";
    return run(`Added ${ids.length} alert${ids.length > 1 ? "s" : ""} to “${title}”`, async () => {
      await groupAlerts(ids, groupId);
      setSelected(new Set());
    });
  };

  const doCreateGroup = (ids: string[], title: string, parentId: string | null) =>
    run(`Created “${title}” and added ${ids.length} alert${ids.length > 1 ? "s" : ""}`, async () => {
      const g = await createGroup(title, parentId);
      await groupAlerts(ids, g.id);
      // Reload so the new group lands in its place in the tree
      const res = await fetch("/api/groups");
      if (res.ok) setGroups((await res.json()).groups || []);
      setSelected(new Set());
    });

  const sortProps = { sortBy, sortDir, onSort };

  const selectedIds = [...selected];

  return (
    <div className="relative">
      {/* Bulk action bar */}
      {selectable && selected.size > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-white shadow-xl dark:bg-slate-800">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <span className="mx-1 h-5 w-px bg-white/20" />
          {canAssignOwner && <Popover open={bulk === "assign"} onOpenChange={(o) => setBulk(o ? "assign" : null)}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20">
                <UserPlus className="h-4 w-4" /> Assign
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-1.5">
              <MemberPicker members={members} onPick={(id) => doAssign(selectedIds, id)} />
            </PopoverContent>
          </Popover>}
          {canGroup && <Popover open={bulk === "group"} onOpenChange={(o) => setBulk(o ? "group" : null)}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20">
                <Tag className="h-4 w-4" /> Add to group
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-1.5">
              <GroupPicker groups={groups} onPick={(id) => doGroup(selectedIds, id)} onCreate={(t, p) => doCreateGroup(selectedIds, t, p)} />
            </PopoverContent>
          </Popover>}
          <Popover open={bulk === "products"} onOpenChange={(o) => setBulk(o ? "products" : null)}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20">
                <Package className="h-4 w-4" /> Attach products
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-1.5">
              <BulkProductsPicker alertIds={selectedIds} onChanged={(text) => { setMessage({ ok: true, text }); onChanged?.(); }} />
            </PopoverContent>
          </Popover>
          {canDelete && (
            <button
              onClick={() => setPendingDelete(selectedIds)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-medium hover:bg-red-500"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          {working && <Loader2 className="h-4 w-4 animate-spin" />}
          <button onClick={() => setSelected(new Set())} className="ml-auto rounded-lg px-2 py-1 text-sm text-white/70 hover:bg-white/10 hover:text-white">
            Clear
          </button>
        </div>
      )}

      {message && (
        <div
          role="status"
          className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            message.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
          }`}
        >
          {message.ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {message.text}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-slate-50/80 dark:bg-slate-800/40">
              {selectable && (
                <th className="w-10 rounded-tl-xl pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(alerts.map((a) => a.id)) : new Set())}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                </th>
              )}
              <SortHead {...sortProps} col="title" className={selectable ? "" : "rounded-tl-xl"}>Alert</SortHead>
              {!compact && <SortHead {...sortProps}>Geography</SortHead>}
              <SortHead {...sortProps} col="deadline">Deadline</SortHead>
              <SortHead {...sortProps} col="score">Score · band</SortHead>
              <SortHead {...sortProps} col="priority">Final priority</SortHead>
              <SortHead {...sortProps}>Owner</SortHead>
              <th className="w-12 rounded-tr-xl" />
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: compact ? 5 : 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="border-t border-slate-100 px-4 py-4 dark:border-slate-800">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                    </td>
                  </tr>
                ))
              : alerts.length === 0
              ? (
                <tr>
                  <td colSpan={8} className="border-t border-slate-100 px-4 py-14 text-center text-sm text-slate-500 dark:border-slate-800">
                    {emptyMessage || "No alerts match these filters."}
                  </td>
                </tr>
              )
              : alerts.map((a) => {
                  const p = PRIORITY[a.effective_priority || "unscored"] || PRIORITY.unscored;
                  const isSel = selected.has(a.id);
                  return (
                    <tr
                      key={a.id}
                      onClick={() => onOpen(a.id)}
                      className={`group cursor-pointer transition-colors ${isSel ? "bg-blue-50/70 dark:bg-blue-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}
                    >
                      {selectable && (
                        <td className="relative border-t border-slate-100 pl-4 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                          <span className={`absolute inset-y-2 left-0 w-1 rounded-r ${p.edge}`} />
                          <input
                            type="checkbox"
                            aria-label={`Select ${a.title}`}
                            checked={isSel}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const n = new Set(prev);
                                if (e.target.checked) n.add(a.id);
                                else n.delete(a.id);
                                return n;
                              })
                            }
                            className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                          />
                        </td>
                      )}
                      <td className={`relative border-t border-slate-100 px-4 ${compact ? "py-2.5" : "py-3.5"} dark:border-slate-800`}>
                        {!selectable && <span className={`absolute inset-y-2 left-0 w-1 rounded-r ${p.edge}`} />}
                        <div className="max-w-[440px]">
                          <div className="line-clamp-2 font-medium leading-snug text-slate-900 group-hover:text-blue-700 dark:text-slate-100 dark:group-hover:text-blue-300">
                            {a.title}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {a.group_id && a.group_title && (
                              <GroupLabel
                                id={a.group_id}
                                title={a.group_title}
                                path={a.group_path}
                                onClick={onGroupClick ? () => onGroupClick(a.group_id!) : undefined}
                              />
                            )}
                            <StageBadge stage={a.stage} />
                          </div>
                        </div>
                      </td>
                      {!compact && (
                        <td className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                          <div className="max-w-[160px] truncate text-[13px] text-slate-700 dark:text-slate-300">
                            {a.geographies && a.geographies.length > 0 ? a.geographies.join(", ") : <span className="text-slate-400">{a.jurisdiction_raw || "—"}</span>}
                          </div>
                          {canEdit && role && a.geographies?.length === 0 && (
                            <div className="mt-1.5">
                              <AlertCountryMapping
                                alertId={a.id}
                                alertTitle={a.title}
                                jurisdiction={a.jurisdiction_raw}
                                onSaved={(text) => {
                                  setMessage({ ok: true, text });
                                  onChanged?.();
                                }}
                              />
                            </div>
                          )}
                        </td>
                      )}
                      <td className="border-t border-slate-100 px-4 py-3 dark:border-slate-800" onClick={(e) => canEdit && e.stopPropagation()}>
                        {canEdit ? (
                          a.next_compliance_deadline ? (
                            <button
                              onClick={() => setDeadlineFor({ id: a.id, title: a.title })}
                              className="-mx-1.5 -my-1 rounded-lg px-1.5 py-1 text-left transition hover:bg-white hover:ring-1 hover:ring-slate-200 dark:hover:bg-slate-800 dark:hover:ring-slate-700"
                              title="View or add deadlines"
                            >
                              <DeadlineCell date={a.next_compliance_deadline} days={a.days_remaining} />
                            </button>
                          ) : (
                            <button
                              onClick={() => setDeadlineFor({ id: a.id, title: a.title })}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:hover:bg-blue-500/10"
                            >
                              <CalendarPlus className="h-3 w-3" /> Add deadline
                            </button>
                          )
                        ) : (
                          <DeadlineCell date={a.next_compliance_deadline} days={a.days_remaining} />
                        )}
                      </td>
                      <td className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                        {/* Real score: the number and the band it gives on its own */}
                        {a.effective_total != null ? (
                          (() => {
                            const sb = PRIORITY[a.score_band || a.effective_priority || "unscored"] || PRIORITY.unscored;
                            return (
                              <div className="w-24">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[13px] font-semibold tabular-nums text-slate-900 dark:text-white">{a.effective_total.toLocaleString()}</span>
                                  <span className={`rounded px-1.5 py-px text-[10px] font-semibold ring-1 ${sb.chip}`}>{sb.label}</span>
                                </div>
                                <div className="mt-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div className={`h-1 rounded-full ${sb.bar}`} style={{ width: `${Math.max(4, (a.effective_total / maxScore) * 100)}%` }} />
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                        {/* Final priority after escalation rules */}
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${p.chip}`}>{p.label}</span>
                        {a.score_band && a.effective_priority && a.score_band !== a.effective_priority && (
                          <span
                            className="mt-1 flex w-fit items-center gap-1 whitespace-nowrap rounded bg-violet-50 px-1.5 py-px text-[10px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                            title={(a.escalation_reasons || []).map((r) => r.description).join("\n") || "Raised by an escalation rule"}
                          >
                            <ArrowUp className="h-3 w-3" />
                            Escalated
                          </span>
                        )}
                      </td>
                      <td className="border-t border-slate-100 px-4 py-3 dark:border-slate-800" onClick={(e) => canAssignOwner && e.stopPropagation()}>
                        {canAssignOwner ? (
                          <Popover open={ownerFor === a.id} onOpenChange={(o) => setOwnerFor(o ? a.id : null)}>
                            <PopoverTrigger asChild>
                              {a.owner_name ? (
                                <button
                                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-full py-0.5 pl-0.5 pr-2.5 text-[13px] text-slate-700 ring-1 ring-transparent transition hover:bg-white hover:ring-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:ring-slate-700"
                                  title="Change owner"
                                >
                                  <UserAvatar name={a.owner_name} src={a.owner_avatar} className="h-6 w-6 text-[10px]" />
                                  {a.owner_name}
                                  <ChevronDown className="h-3 w-3 opacity-50" />
                                </button>
                              ) : (
                                <button className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:hover:bg-blue-500/10">
                                  <UserPlus className="h-3 w-3" /> Assign
                                </button>
                              )}
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-72 p-1.5">
                              <MemberPicker
                                members={members}
                                selectedId={a.owner_membership_id}
                                onPick={(id) => {
                                  setOwnerFor(null);
                                  doAssign([a.id], id);
                                }}
                              />
                            </PopoverContent>
                          </Popover>
                        ) : a.owner_name ? (
                          <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-slate-700 dark:text-slate-300">
                            <UserAvatar name={a.owner_name} src={a.owner_avatar} className="h-6 w-6 text-[10px]" />
                            {a.owner_name}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="border-t border-slate-100 px-2 py-3 text-right dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                        <Popover open={menuFor?.id === a.id} onOpenChange={(o) => setMenuFor(o ? { id: a.id, view: "menu" } : null)}>
                          <PopoverTrigger asChild>
                            <button
                              className="rounded-lg p-1.5 text-slate-400 opacity-70 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                              aria-label="Row actions"
                            >
                              <MoreHorizontal className="h-5 w-5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-64 p-1.5">
                            {menuFor?.view === "assign" ? (
                              <MemberPicker members={members} selectedId={a.owner_membership_id} onPick={(id) => doAssign([a.id], id)} />
                            ) : menuFor?.view === "products" ? (
                              <AlertProductsPicker
                                alertId={a.id}
                                onChanged={(text) => { setMessage({ ok: true, text }); onChanged?.(); }}
                              />
                            ) : menuFor?.view === "group" ? (
                              <GroupPicker groups={groups} selectedId={a.group_id} onPick={(id) => doGroup([a.id], id)} onCreate={(t, p) => doCreateGroup([a.id], t, p)} />
                            ) : (
                              <div className="text-sm">
                                <button onClick={() => { setMenuFor(null); onOpen(a.id); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                  <Eye className="h-4 w-4 text-slate-500" /> Open details
                                </button>
                                {canEdit && (
                                  <>
                                    {canAssignOwner && <button onClick={() => setMenuFor({ id: a.id, view: "assign" })} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                      <UserPlus className="h-4 w-4 text-slate-500" /> {a.owner_name ? "Reassign owner" : "Assign owner"}
                                    </button>}
                                    {canGroup && <button onClick={() => setMenuFor({ id: a.id, view: "group" })} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                      <Tag className="h-4 w-4 text-slate-500" /> {a.group_title ? "Change group" : "Add to group"}
                                    </button>}
                                    <button onClick={() => setMenuFor({ id: a.id, view: "products" })} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                      <Package className="h-4 w-4 text-slate-500" /> Attach products
                                    </button>
                                    <button
                                      onClick={() => { setMenuFor(null); setDeadlineFor({ id: a.id, title: a.title }); }}
                                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      <CalendarPlus className="h-4 w-4 text-slate-500" /> {a.next_compliance_deadline ? "Deadlines" : "Add deadline"}
                                    </button>
                                    <button onClick={() => { setMenuFor(null); onOpen(a.id); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                      <CalendarClock className="h-4 w-4 text-slate-500" /> Adjust score
                                    </button>
                                  </>
                                )}
                                {canDelete && (
                                  <button
                                    onClick={() => { setMenuFor(null); setPendingDelete([a.id]); }}
                                    className="mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-slate-100 px-2.5 py-2 text-red-600 hover:bg-red-50 dark:border-slate-800 dark:hover:bg-red-500/10"
                                  >
                                    <Trash2 className="h-4 w-4" /> Delete alert
                                  </button>
                                )}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {deadlineFor && (
        <DeadlineDialog
          alertId={deadlineFor.id}
          alertTitle={deadlineFor.title}
          canEdit={canEdit}
          onClose={() => setDeadlineFor(null)}
          onChanged={() => onChanged?.()}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete && pendingDelete.length > 1 ? `Delete ${pendingDelete.length} alerts?` : "Delete this alert?"}
        description={
          <>
            This permanently removes {pendingDelete && pendingDelete.length > 1 ? "these alerts" : "the alert"} with their scores, deadlines,
            group links and history. This can&apos;t be undone — re-import the file to bring them back.
          </>
        }
        confirmLabel="Delete"
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const ids = pendingDelete || [];
          const n = await deleteAlertsRequest({ ids });
          setSelected(new Set());
          setMessage({ ok: true, text: `Deleted ${n} alert${n === 1 ? "" : "s"}` });
          onChanged?.();
        }}
      />
    </div>
  );
}
