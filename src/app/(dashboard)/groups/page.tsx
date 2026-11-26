"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight, ChevronDown, ChevronLeft, ChevronUp, ChevronsUpDown, Plus, MoreHorizontal, Pencil, FolderTree, Trash2, Eye, Search,
  Loader2, X, Layers, Sparkles, Info, CheckCircle2, AlertTriangle, CalendarClock, Tag, ExternalLink, SlidersHorizontal, UserPlus,
} from "lucide-react";
import { AlertDrawer } from "@/components/alerts/alert-drawer";
import { askChangeComment, commentHeader } from "@/components/layout/change-comment";
import { LEVEL_LABELS } from "@/lib/grouping/labels";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/alerts/confirm-dialog";
import { groupColor, useAssignables, MemberPicker, MAX_GROUP_DEPTH } from "@/components/alerts/alerts-table";
import { useSessionInfo } from "@/components/layout/session-context";
import { canMakeChanges } from "@/lib/auth/permissions";
import { isDeleteAllowed } from "@/lib/delete-settings";
import { GroupDrawer } from "@/components/groups/group-drawer";
import { AiGroupingDialog } from "@/components/groups/ai-grouping-dialog";
import {
  BandBar, BulkLabelEditor, GroupLabels, LABEL_COLORS, LABEL_STYLE, OwnerPicker, PRIORITY_RANK, PriorityBadge, formatDay, identText,
  type Group, type GroupAlert, type GroupLabel,
} from "@/components/groups/group-ui";

interface ReviewItem {
  id: string;
  title: string;
  group_id?: string | null;
  confidence: number;
  basis: string;
  group_path: string[];
  priority: string | null;
}

type FormState = {
  mode: "create" | "edit";
  id?: string;
  title: string;
  parent_group_id: string | null;
  jurisdiction_ref: string;
  issuer: string;
  description: string;
  level: "" | "family" | "action";
  group_key: string;
  identifiers_text: string;
  labels: string[];
};

type SortKey = "name" | "alerts" | "priority" | "score" | "deadline" | "owner";
type DrawerTab = "overview" | "versions" | "subgroups";

interface Filters {
  q: string;
  level: "all" | "family" | "action" | "other";
  labels: string[];
  priority: "all" | "critical" | "high" | "moderate" | "low" | "none";
  owner: "all" | "unassigned" | string;
  review: boolean;
}
const NO_FILTERS: Filters = { q: "", level: "all", labels: [], priority: "all", owner: "all", review: false };
const PAGE_SIZES = [10, 25, 50];

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const selectCls =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

/** Suggested key: Jurisdiction-Authority-Identifier (e.g. US-EPA-AIM_ACT); an action adds to its family's key. */
function suggestKey(jur: string, issuer: string, title: string, parentKey?: string | null) {
  const seg = (x: string) => x.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase().slice(0, 40);
  if (parentKey) return `${parentKey}-${seg(title)}`;
  const j = jur.trim().length <= 6 ? jur.trim().toUpperCase().replace(/\s+/g, "-") : seg(jur).slice(0, 6);
  return [j, seg(issuer), seg(title)].filter(Boolean).join("-");
}

function SortHeader({
  label, k, sort, onSort, className = "", title,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  className?: string;
  title?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th className={`px-3 py-2.5 ${className}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} title={title}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-800 dark:hover:text-slate-200 ${active ? "text-slate-800 dark:text-slate-100" : ""}`}>
        {label} <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />
      </button>
    </th>
  );
}

export default function GroupsPage() {
  const session = useSessionInfo();
  const role = session?.membership.role;
  // Reviewers and risk owners can only look
  const canEdit = canMakeChanges(role);
  const canAssign = role === "company_admin" || role === "manager";
  // Deleting groups is switched on or off in Settings › Workspace
  const canDelete = canEdit && isDeleteAllowed(session?.company.settings, "groups");

  const [groups, setGroups] = useState<Group[]>([]);
  const [alerts, setAlerts] = useState<GroupAlert[]>([]);
  const [labels, setLabels] = useState<GroupLabel[]>([]);
  const [review, setReview] = useState<ReviewItem[]>([]);
  // Suggested groupings selected for a bulk confirm / reject
  const [reviewSel, setReviewSel] = useState<Set<string>>(new Set());
  const [deciding, setDeciding] = useState(false);
  // Selected items that are still waiting for review (the list reloads after each decision)
  const reviewChosen = review.filter((i) => reviewSel.has(i.id));
  // Suggestions shown per group: one alert is in one group, a group can hold several similar alerts
  const reviewGroups = useMemo(() => {
    const m = new Map<string, { key: string; path: string; items: ReviewItem[] }>();
    for (const i of review) {
      const key = i.group_id || i.group_path.join(" › ") || "none";
      if (!m.has(key)) m.set(key, { key, path: i.group_path.join(" › ") || "Group", items: [] });
      m.get(key)!.items.push(i);
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length || a.path.localeCompare(b.path));
  }, [review]);
  const [loading, setLoading] = useState(true);
  const { members } = useAssignables(canAssign);

  // Table state: collapsed by default; filters, sort and paging of top-level groups
  const [openOverride, setOpenOverride] = useState<Map<string, boolean>>(new Map());
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "priority", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [grouping, setGrouping] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // AI grouping can be switched off in Settings › AI; the button is hidden then
  const [aiOn, setAiOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/ai/features")
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => !cancelled && setAiOn(!!f?.grouping))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [newLabel, setNewLabel] = useState("");
  const [drawer, setDrawer] = useState<{ id: string; tab: DrawerTab } | null>(null);
  const [openAlert, setOpenAlert] = useState<string | null>(null);
  // Multi-select for bulk label / owner / delete
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMenu, setBulkMenu] = useState<"labels" | "owner" | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  /* ---------- Loading ---------- */

  const load = useCallback(async () => {
    const res = await fetch("/api/groups?alerts=1");
    const data = res.ok ? await res.json() : { groups: [], alerts: [] };
    const next: Group[] = data.groups || [];
    setGroups(next);
    // Forget selections for groups that no longer exist
    setSelected((prev) => (prev.size ? new Set([...prev].filter((id) => next.some((g) => g.id === id))) : prev));
    setAlerts(data.alerts || []);
    setLoading(false);
  }, []);
  const loadReview = useCallback(async () => {
    const res = await fetch("/api/groups/review");
    if (res.ok) setReview((await res.json()).items || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/groups?alerts=1").then((r) => (r.ok ? r.json() : { groups: [], alerts: [] })),
      fetch("/api/groups/review").then((r) => (r.ok ? r.json() : { items: [] })),
      fetch("/api/groups/labels").then((r) => (r.ok ? r.json() : { labels: [] })),
    ]).then(([g, r, l]) => {
      if (cancelled) return;
      setGroups(g.groups || []);
      setAlerts(g.alerts || []);
      setReview(r.items || []);
      setLabels(l.labels || []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, Group[]>();
    for (const g of groups) {
      const p = g.parent_group_id && byId.has(g.parent_group_id) ? g.parent_group_id : null;
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(g);
    }
    return m;
  }, [groups, byId]);

  /* ---------- Filter, sort, page ---------- */

  const filterActive =
    !!filters.q.trim() || filters.level !== "all" || filters.labels.length > 0 || filters.priority !== "all" || filters.owner !== "all" || filters.review;

  const updateFilters = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setOpenOverride(new Map());
    setPage(1);
  };

  const { keep, autoOpen, matched } = useMemo(() => {
    const keepSet = new Set<string>();
    const open = new Set<string>();
    const hit = new Set<string>();
    if (!filterActive) return { keep: null as Set<string> | null, autoOpen: open, matched: hit };
    const term = filters.q.trim().toLowerCase();
    const has = (g: Group, l: string) => g.labels.some((x) => x.toLowerCase() === l.toLowerCase());
    for (const g of groups) {
      const hay = [g.title, g.group_key, g.issuer, g.jurisdiction_ref, g.description, ...g.labels, ...g.identifiers.map(identText)].join(" ").toLowerCase();
      if (term && !hay.includes(term)) continue;
      if (filters.level === "family" && g.level !== "family") continue;
      if (filters.level === "action" && g.level !== "action") continue;
      if (filters.level === "other" && g.level) continue;
      if (filters.labels.length && !filters.labels.some((l) => has(g, l))) continue;
      if (filters.priority === "none" ? !!g.highest_priority : filters.priority !== "all" && g.highest_priority !== filters.priority) continue;
      if (filters.owner === "unassigned" ? !!g.owner_membership_id : filters.owner !== "all" && g.owner_membership_id !== filters.owner) continue;
      if (filters.review && g.needs_review === 0) continue;
      keepSet.add(g.id);
      hit.add(g.id);
      // Ancestors stay visible (and open) so the match sits in its tree
      for (let p = g.parent_group_id ? byId.get(g.parent_group_id) : undefined; p; p = p.parent_group_id ? byId.get(p.parent_group_id) : undefined) {
        keepSet.add(p.id);
        open.add(p.id);
      }
    }
    return { keep: keepSet, autoOpen: open, matched: hit };
  }, [groups, byId, filters, filterActive]);

  const compare = useCallback(
    (a: Group, b: Group) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      const byName = a.title.localeCompare(b.title);
      const last = (x: unknown) => x === null || x === undefined;
      switch (sort.key) {
        case "name":
          return dir * byName;
        case "alerts":
          return dir * (a.total_count - b.total_count) || byName;
        case "priority":
          return dir * ((PRIORITY_RANK[a.highest_priority ?? ""] ?? 0) - (PRIORITY_RANK[b.highest_priority ?? ""] ?? 0)) || dir * ((a.score ?? -1) - (b.score ?? -1)) || byName;
        case "score":
          return dir * ((a.score ?? -1) - (b.score ?? -1)) || byName;
        case "deadline":
          // Groups without a deadline always go last
          if (last(a.next_deadline) !== last(b.next_deadline)) return last(a.next_deadline) ? 1 : -1;
          return dir * String(a.next_deadline ?? "").localeCompare(String(b.next_deadline ?? "")) || byName;
        case "owner":
          if (last(a.owner_name) !== last(b.owner_name)) return last(a.owner_name) ? 1 : -1;
          return dir * String(a.owner_name ?? "").localeCompare(String(b.owner_name ?? "")) || byName;
      }
    },
    [sort]
  );

  const onSort = (k: SortKey) => {
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "name" || k === "owner" || k === "deadline" ? "asc" : "desc" }));
    setPage(1);
  };

  const isOpen = (id: string) => (openOverride.has(id) ? openOverride.get(id)! : autoOpen.has(id));
  const kids = (id: string | null) => (childrenOf.get(id) || []).filter((g) => !keep || keep.has(g.id)).sort(compare);

  const roots = kids(null);
  const pageCount = Math.max(1, Math.ceil(roots.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRoots = roots.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rows: Group[] = [];
  const walk = (list: Group[]) => {
    for (const g of list) {
      rows.push(g);
      if (isOpen(g.id)) walk(kids(g.id));
    }
  };
  walk(pageRoots);

  const toggle = (id: string) => setOpenOverride((m) => new Map(m).set(id, !isOpen(id)));
  const expandAll = () => setOpenOverride(new Map(groups.filter((g) => g.child_count > 0).map((g) => [g.id, true])));
  const collapseAll = () => setOpenOverride(new Map(groups.map((g) => [g.id, false])));

  /* ---------- Actions ---------- */

  const parentOptions = (editingId?: string) => {
    let height = 1;
    const blocked = new Set<string>();
    if (editingId) {
      const own = [editingId];
      for (let i = 0; i < own.length; i++) for (const g of groups) if (g.parent_group_id === own[i]) own.push(g.id);
      own.forEach((id) => blocked.add(id));
      const self = byId.get(editingId);
      if (self) height = Math.max(...own.map((id) => byId.get(id)?.depth ?? self.depth)) - self.depth + 1;
    }
    return groups.map((g) => ({ g, disabled: blocked.has(g.id) || g.depth + height > MAX_GROUP_DEPTH }));
  };

  const openCreate = (parentId: string | null = null) => {
    setFormError(null);
    setNewLabel("");
    const parent = parentId ? byId.get(parentId) : null;
    setForm({
      mode: "create", title: "", parent_group_id: parentId,
      jurisdiction_ref: parent?.jurisdiction_ref || "", issuer: parent?.issuer || "", description: "",
      level: parent?.level === "family" ? "action" : parentId ? "" : "family", group_key: "", identifiers_text: "",
      labels: parent?.labels || [],
    });
  };
  const openEdit = (g: Group) => {
    setFormError(null);
    setNewLabel("");
    setForm({
      mode: "edit", id: g.id, title: g.title, parent_group_id: g.parent_group_id,
      jurisdiction_ref: g.jurisdiction_ref || "", issuer: g.issuer || "", description: g.description || "",
      level: g.level || "", group_key: g.group_key || "", identifiers_text: g.identifiers.map(identText).join(", "), labels: g.labels,
    });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    // Editing an existing group is a change, so ask why (creating one needs no comment)
    let comment: string | null = null;
    if (form.mode === "edit") {
      comment = await askChangeComment({ action: `Edit group “${form.title.trim()}”` });
      if (!comment) return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(form.mode === "create" ? "/api/groups" : `/api/groups/${form.id}`, {
        method: form.mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, parent_group_id: form.parent_group_id, jurisdiction_ref: form.jurisdiction_ref, issuer: form.issuer,
          description: form.description, level: form.level, group_key: form.group_key, identifiers_text: form.identifiers_text,
          labels: form.labels, comment,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save group");
      if (form.parent_group_id) setOpenOverride((m) => new Map(m).set(form.parent_group_id!, true));
      setFlash({ ok: true, text: form.mode === "create" ? `Created “${form.title.trim()}”` : "Group saved" });
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save group");
    } finally {
      setSaving(false);
    }
  }

  async function setOwner(g: Group, membershipId: string | null) {
    setMenuFor(null);
    if (membershipId === g.owner_membership_id) return;
    const who = members.find((m) => m.id === membershipId)?.display_name;
    const comment = await askChangeComment({
      action: membershipId ? `Set owner of ${g.title} to ${who ?? "team member"}` : `Remove the owner of ${g.title}`,
      detail: "Alerts in the group without their own owner follow the group owner",
    });
    if (!comment) return;
    const res = await fetch(`/api/groups/${g.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign_owner", membership_id: membershipId, comment }),
    });
    setFlash(res.ok ? { ok: true, text: membershipId ? `${who ?? "Owner"} now owns ${g.title}` : "Owner removed" } : { ok: false, text: "Could not change owner" });
    load();
  }

  async function setGroupLabels(g: Group, next: string[]) {
    const added = next.filter((n) => !g.labels.some((x) => x.toLowerCase() === n.toLowerCase()));
    const removed = g.labels.filter((x) => !next.some((n) => n.toLowerCase() === x.toLowerCase()));
    if (!added.length && !removed.length) return;
    const comment = await askChangeComment({
      action: [added.length ? `Add label${added.length > 1 ? "s" : ""} ${added.join(", ")}` : null, removed.length ? `remove ${removed.join(", ")}` : null]
        .filter(Boolean).join("; ").replace(/^r/, "R"),
      detail: g.title,
    });
    if (!comment) return;
    const res = await fetch(`/api/groups/${g.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: next, comment }),
    });
    const body = await res.json().catch(() => ({}));
    setFlash(res.ok ? { ok: true, text: `Labels updated on ${g.title}` } : { ok: false, text: body.error || "Could not update labels" });
    load();
  }

  /* ---------- Bulk actions on selected groups ---------- */

  const selectedGroups = groups.filter((g) => selected.has(g.id));
  // Deleting a group deletes its sub-groups, so only the top-most selected groups need a request
  const topSelected = selectedGroups.filter((g) => !ancestorsSelected(g));
  function ancestorsSelected(g: Group) {
    for (let p = g.parent_group_id; p; p = byId.get(p)?.parent_group_id ?? null) if (selected.has(p)) return true;
    return false;
  }
  const toggleSelect = (id: string, on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  async function runBulk(label: string, list: Group[], fn: (g: Group) => Promise<Response | null>) {
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const g of list) {
        const res = await fn(g);
        if (!res) continue;
        if (res.ok) ok++;
        else failed++;
      }
    } finally {
      setBulkBusy(false);
    }
    setFlash(failed ? { ok: false, text: `${label}: ${ok} done, ${failed} failed` } : { ok: true, text: `${label} · ${ok} group${ok === 1 ? "" : "s"}` });
    await load();
  }

  async function bulkLabels(add: string[], remove: string[]) {
    setBulkMenu(null);
    const list = selectedGroups;
    const comment = await askChangeComment({
      action: [add.length ? `Add label${add.length > 1 ? "s" : ""} ${add.join(", ")}` : null, remove.length ? `remove ${remove.join(", ")}` : null]
        .filter(Boolean).join("; ").replace(/^r/, "R"),
      detail: `${list.length} group${list.length === 1 ? "" : "s"}`,
    });
    if (!comment) return;
    const lc = (x: string) => x.toLowerCase();
    await runBulk("Labels updated", list, async (g) => {
      const next = [...g.labels.filter((x) => !remove.some((r) => lc(r) === lc(x))), ...add.filter((a) => !g.labels.some((x) => lc(x) === lc(a)))];
      const same = next.length === g.labels.length && next.every((n) => g.labels.some((x) => lc(x) === lc(n)));
      if (same) return null;
      return fetch(`/api/groups/${g.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: next, comment }),
      });
    });
  }

  async function bulkOwner(membershipId: string | null) {
    setBulkMenu(null);
    const list = selectedGroups.filter((g) => g.owner_membership_id !== membershipId);
    const who = members.find((m) => m.id === membershipId)?.display_name;
    const comment = await askChangeComment({
      action: membershipId ? `Set owner to ${who ?? "team member"}` : "Remove owner",
      detail: `${selectedGroups.length} group${selectedGroups.length === 1 ? "" : "s"} · alerts without their own owner follow the group owner`,
    });
    if (!comment) return;
    await runBulk(membershipId ? "Owner set" : "Owner removed", list, (g) =>
      fetch(`/api/groups/${g.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_owner", membership_id: membershipId, comment }),
      })
    );
  }

  async function createLabel(name: string): Promise<string | null> {
    const clean = name.trim();
    if (!clean) return null;
    const res = await fetch("/api/groups/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: clean, color: LABEL_COLORS[(labels.length + 2) % LABEL_COLORS.length] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFlash({ ok: false, text: body.error || "Could not add the label" });
      return null;
    }
    setLabels((ls) => (ls.some((l) => l.id === body.label.id) ? ls : [...ls, body.label]));
    return body.label.name as string;
  }

  async function runAuto() {
    setGrouping(true);
    try {
      const res = await fetch("/api/groups/auto", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Automatic grouping failed");
      const r = body.result;
      const placed = r.placed.exact + r.placed.strong + r.placed.similarity;
      const created = r.families_created || r.actions_created
        ? ` · created ${r.families_created} famil${r.families_created === 1 ? "y" : "ies"} and ${r.actions_created} action${r.actions_created === 1 ? "" : "s"}`
        : "";
      setFlash({
        ok: true,
        text: placed
          ? `Grouped ${placed} alert${placed > 1 ? "s" : ""} (${r.placed.exact} exact, ${r.placed.strong} by CFR part, ${r.placed.similarity} by similarity)${created}`
          : `Checked ${r.scanned} alerts (${r.identifiers} identifiers found) — nothing new to group`,
      });
      await Promise.all([load(), loadReview()]);
    } catch (err) {
      setFlash({ ok: false, text: err instanceof Error ? err.message : "Automatic grouping failed" });
    } finally {
      setGrouping(false);
    }
  }

  /** Confirm or reject one or more suggested groupings (one comment covers them all). */
  async function decide(items: ReviewItem[], decision: "confirm" | "reject") {
    if (!items.length) return;
    const one = items.length === 1 ? items[0] : null;
    const path = one ? one.group_path.join(" › ") : "";
    const comment = await askChangeComment({
      action: one
        ? decision === "confirm" ? `Confirm grouping into ${path}` : `Reject grouping — remove from ${path}`
        : decision === "confirm" ? `Confirm ${items.length} suggested groupings` : `Reject ${items.length} suggested groupings — remove them from their groups`,
      detail: one ? one.title : items.slice(0, 3).map((i) => i.title).join(" · ") + (items.length > 3 ? ` · and ${items.length - 3} more` : ""),
      // Rejecting a suggested grouping doesn't need a reason
      optional: decision === "reject",
      confirmLabel: decision === "reject" ? (one ? "Reject" : `Reject ${items.length}`) : one ? undefined : `Confirm ${items.length}`,
    });
    if (comment === null || (decision === "confirm" && !comment)) return;
    setDeciding(true);
    try {
      const res = await fetch("/api/groups/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_ids: items.map((i) => i.id), decision, comment }),
      });
      const n = res.ok ? ((await res.json()).count as number) ?? items.length : 0;
      setFlash(
        res.ok
          ? { ok: true, text: decision === "confirm" ? `${n === 1 ? "Grouping" : `${n} groupings`} confirmed` : `${n === 1 ? "Alert" : `${n} alerts`} removed from ${n === 1 ? "the group" : "their groups"}` }
          : { ok: false, text: "Could not save the decision" }
      );
      if (res.ok) setReviewSel((s) => { const next = new Set(s); items.forEach((i) => next.delete(i.id)); return next; });
    } finally {
      setDeciding(false);
    }
    await Promise.all([load(), loadReview()]);
  }

  const parentChoices = form ? parentOptions(form.mode === "edit" ? form.id : undefined) : [];
  const formParent = form?.parent_group_id ? byId.get(form.parent_group_id) : null;
  const drawerGroup = drawer ? byId.get(drawer.id) : undefined;
  const ownerChoices = members.filter((m) => groups.some((g) => g.owner_membership_id === m.id));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Regulation Groups</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            One risk = one regulatory family: Family › Action › Version.{" "}
            <button type="button" onClick={() => setShowHow((v) => !v)} aria-expanded={showHow} className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline dark:text-blue-400">
              <Info className="h-3.5 w-3.5" /> How grouping works
            </button>
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2 self-start">
            <button
              onClick={runAuto}
              disabled={grouping}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title="Group alerts by shared identifiers, CFR part and subject similarity"
            >
              {grouping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Run automatic grouping
            </button>
            {aiOn && (
            <button
              onClick={() => setAiOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
              title="Let your language model review every alert and its source link, and propose groups by regulation"
            >
              <Sparkles className="h-4 w-4" /> AI grouping
            </button>
            )}
            <button onClick={() => openCreate(null)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700">
              <Plus className="h-4 w-4" /> New group
            </button>
          </div>
        )}
      </div>

      {showHow && (
        <section className="panel grid gap-4 p-5 text-sm md:grid-cols-2">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Hierarchy</h2>
            <ol className="mt-2 space-y-1.5 text-slate-600 dark:text-slate-300">
              <li><strong className="text-slate-800 dark:text-slate-100">Level 1 · Regulatory family</strong> — the master record. Key = Jurisdiction + Issuing authority + Primary identifier, e.g. <code className="text-xs">US-EPA-AIM_ACT</code>.</li>
              <li><strong className="text-slate-800 dark:text-slate-100">Level 2 · Regulatory action</strong> — all versions of the same action, e.g. <code className="text-xs">US-EPA-AIM_ACT-ALLOCATIONS</code>.</li>
              <li><strong className="text-slate-800 dark:text-slate-100">Level 3 · Version</strong> — each alert: proposed rule, supplemental proposal, final rule, correction, amendment or enforcement guidance.</li>
            </ol>
            <p className="mt-2 text-xs text-slate-500">A group&apos;s priority and score are those of its highest version.</p>
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Matching (runs after every import)</h2>
            <ol className="mt-2 space-y-1.5 text-slate-600 dark:text-slate-300">
              <li><strong className="text-slate-800 dark:text-slate-100">1 · Exact (100%)</strong> — same RIN, docket, bill, agency tracking or WTO number → same action.</li>
              <li><strong className="text-slate-800 dark:text-slate-100">2 · Strong (95%)</strong> — same jurisdiction + agency + CFR part → same family.</li>
              <li><strong className="text-slate-800 dark:text-slate-100">3 · Similar subject (≥ 80%)</strong> — same jurisdiction + agency + similar title → same family, until someone confirms.</li>
              <li><strong className="text-slate-800 dark:text-slate-100">Manual</strong> — moving an alert by hand records your comment as the basis; it is never moved automatically again.</li>
            </ol>
          </div>
        </section>
      )}

      {review.length > 0 && (
        <section className="panel overflow-hidden">
          <header className="flex min-h-[52px] flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
            {canEdit && (
              <input
                type="checkbox"
                aria-label="Select all suggested groupings"
                checked={reviewChosen.length > 0 && reviewChosen.length === review.length}
                ref={(el) => {
                  if (el) el.indeterminate = reviewChosen.length > 0 && reviewChosen.length < review.length;
                }}
                onChange={(e) => setReviewSel(e.target.checked ? new Set(review.map((i) => i.id)) : new Set())}
                className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)]"
              />
            )}
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Grouped by similar subject — confirm or reject</h2>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{review.length}</span>
            {canEdit && reviewChosen.length > 0 && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-slate-600 dark:text-slate-300">{reviewChosen.length} selected</span>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => decide(reviewChosen, "confirm")}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirm {reviewChosen.length}
                </button>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => decide(reviewChosen, "reject")}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Reject {reviewChosen.length}
                </button>
                <button type="button" onClick={() => setReviewSel(new Set())} className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Clear
                </button>
              </div>
            )}
          </header>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {reviewGroups.map((grp) => {
              const picked = grp.items.filter((i) => reviewSel.has(i.id)).length;
              return (
                <li key={grp.key}>
                  {/* One suggested group, with all the similar alerts placed in it */}
                  <div className="flex flex-col gap-2 bg-slate-50/70 px-4 py-2.5 sm:flex-row sm:items-center dark:bg-slate-800/30">
                    {canEdit && (
                      <input
                        type="checkbox"
                        aria-label={`Select all alerts in ${grp.path}`}
                        checked={picked === grp.items.length}
                        ref={(el) => {
                          if (el) el.indeterminate = picked > 0 && picked < grp.items.length;
                        }}
                        onChange={(e) =>
                          setReviewSel((s) => {
                            const next = new Set(s);
                            grp.items.forEach((i) => (e.target.checked ? next.add(i.id) : next.delete(i.id)));
                            return next;
                          })
                        }
                        className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[var(--primary)]"
                      />
                    )}
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <FolderTree className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="truncate text-sm font-semibold text-slate-900 dark:text-white" title={grp.path}>{grp.path}</span>
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                        {grp.items.length} alert{grp.items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {canEdit && grp.items.length > 1 && (
                      <div className="flex shrink-0 gap-1.5">
                        <button disabled={deciding} onClick={() => decide(grp.items, "confirm")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:ring-emerald-500/30 dark:hover:bg-emerald-500/10">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Confirm all {grp.items.length}
                        </button>
                        <button disabled={deciding} onClick={() => decide(grp.items, "reject")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/10">
                          <X className="h-3.5 w-3.5" /> Reject all {grp.items.length}
                        </button>
                      </div>
                    )}
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {grp.items.map((item) => (
                      <li key={item.id} className={`flex flex-col gap-2 py-2.5 pl-10 pr-4 sm:flex-row sm:items-center ${reviewSel.has(item.id) ? "bg-blue-50/50 dark:bg-blue-500/5" : ""}`}>
                        {canEdit && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.title}`}
                            checked={reviewSel.has(item.id)}
                            onChange={(e) =>
                              setReviewSel((s) => {
                                const next = new Set(s);
                                if (e.target.checked) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              })
                            }
                            className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[var(--primary)]"
                          />
                        )}
                        <button type="button" onClick={() => setOpenAlert(item.id)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-medium text-slate-900 hover:text-blue-600 dark:text-white" title={item.title}>{item.title}</p>
                          <p className="truncate text-xs text-slate-500" title={item.basis}>
                            {item.confidence}% · {item.basis}
                          </p>
                        </button>
                        {canEdit && (
                          <div className="flex shrink-0 gap-1.5">
                            <button disabled={deciding} onClick={() => decide([item], "confirm")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:ring-emerald-500/30 dark:hover:bg-emerald-500/10">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
                            </button>
                            <button disabled={deciding} onClick={() => decide([item], "reject")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/10">
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {flash && (
        <div role="status" className={`rounded-lg px-4 py-2.5 text-sm ${flash.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"}`}>
          {flash.text}
        </div>
      )}

      <div className="panel overflow-hidden">
        {/* Filters */}
        <div className="space-y-2.5 border-b border-slate-100 p-3 dark:border-slate-800">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.q}
                onChange={(e) => updateFilters({ q: e.target.value })}
                placeholder="Search name, key, identifier, issuer…"
                aria-label="Search groups"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SlidersHorizontal className="hidden h-4 w-4 text-slate-400 lg:block" />
              <select aria-label="Level" value={filters.level} onChange={(e) => updateFilters({ level: e.target.value as Filters["level"] })} className={selectCls}>
                <option value="all">All levels</option>
                <option value="family">Families</option>
                <option value="action">Actions</option>
                <option value="other">Free-form groups</option>
              </select>
              <select aria-label="Priority" value={filters.priority} onChange={(e) => updateFilters({ priority: e.target.value as Filters["priority"] })} className={selectCls}>
                <option value="all">Any priority</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="moderate">Moderate</option>
                <option value="low">Low</option>
                <option value="none">No alerts / unscored</option>
              </select>
              <select aria-label="Owner" value={filters.owner} onChange={(e) => updateFilters({ owner: e.target.value })} className={selectCls}>
                <option value="all">Any owner</option>
                <option value="unassigned">Unassigned</option>
                {ownerChoices.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
              <button
                type="button"
                aria-pressed={filters.review}
                onClick={() => updateFilters({ review: !filters.review })}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${filters.review ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Needs review
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by label">
              <Tag className="h-3.5 w-3.5 text-slate-400" />
              {labels.map((l) => {
                const on = filters.labels.some((x) => x.toLowerCase() === l.name.toLowerCase());
                const count = groups.filter((g) => g.labels.some((x) => x.toLowerCase() === l.name.toLowerCase())).length;
                return (
                  <button
                    key={l.id}
                    onClick={() => updateFilters({ labels: on ? filters.labels.filter((x) => x.toLowerCase() !== l.name.toLowerCase()) : [...filters.labels, l.name] })}
                    aria-pressed={on}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ${on ? LABEL_STYLE[l.color] || LABEL_STYLE.slate : "text-slate-600 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"}`}
                  >
                    {l.name} <span className="tabular-nums opacity-60">{count}</span>
                  </button>
                );
              })}
              {filterActive && (
                <button onClick={() => updateFilters(NO_FILTERS)} className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                  <X className="h-3 w-3" /> Clear filters
                </button>
              )}
            </div>
            <div className="flex gap-1">
              <button onClick={expandAll} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Expand all</button>
              <button onClick={collapseAll} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Collapse all</button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[...Array(5)].map((_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}</div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
              <FolderTree className="h-6 w-6" />
            </div>
            <p className="mt-3 font-semibold text-slate-900 dark:text-white">No regulation groups yet</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">Run automatic grouping, or create a regulatory family (e.g. “AIM Act”) and add its actions.</p>
            {canEdit && (
              <button onClick={() => openCreate(null)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                <Plus className="h-4 w-4" /> New group
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Bulk action bar */}
            {canEdit && selected.size > 0 && (
              <div className="sticky top-2 z-20 mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-white shadow-xl dark:bg-slate-800">
                <span className="text-sm font-semibold">{selected.size} selected</span>
                <span className="mx-1 h-5 w-px bg-white/20" />
                <Popover open={bulkMenu === "labels"} onOpenChange={(o) => setBulkMenu(o ? "labels" : null)}>
                  <PopoverTrigger asChild>
                    <button disabled={bulkBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20 disabled:opacity-50">
                      <Tag className="h-4 w-4" /> Labels
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-1.5">
                    <BulkLabelEditor labels={labels} groups={selectedGroups} onApply={bulkLabels} onCreate={createLabel} />
                  </PopoverContent>
                </Popover>
                {canAssign && (
                  <Popover open={bulkMenu === "owner"} onOpenChange={(o) => setBulkMenu(o ? "owner" : null)}>
                    <PopoverTrigger asChild>
                      <button disabled={bulkBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20 disabled:opacity-50">
                        <UserPlus className="h-4 w-4" /> Owner
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 p-1.5">
                      <MemberPicker members={members} onPick={bulkOwner} />
                      {selectedGroups.some((g) => g.owner_membership_id) && (
                        <button onClick={() => bulkOwner(null)} className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-2.5 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-slate-800 dark:hover:bg-red-500/10">
                          <X className="h-4 w-4" /> Remove owner
                        </button>
                      )}
                    </PopoverContent>
                  </Popover>
                )}
                {canDelete && <button
                  disabled={bulkBusy}
                  onClick={() => setBulkDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-medium hover:bg-red-500 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>}
                {bulkBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                <button onClick={() => setSelected(new Set())} className="ml-auto rounded-lg px-2 py-1 text-sm text-white/70 hover:bg-white/10 hover:text-white">
                  Clear
                </button>
              </div>
            )}
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    {canEdit && (
                      <th className="w-9 py-2.5 pl-3 pr-0">
                        <input
                          type="checkbox"
                          aria-label="Select all groups shown"
                          checked={rows.length > 0 && rows.every((g) => selected.has(g.id))}
                          ref={(el) => {
                            if (el) el.indeterminate = rows.some((g) => selected.has(g.id)) && !rows.every((g) => selected.has(g.id));
                          }}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setSelected((prev) => {
                              const n = new Set(prev);
                              for (const g of rows) {
                                if (on) n.add(g.id);
                                else n.delete(g.id);
                              }
                              return n;
                            });
                          }}
                          className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                        />
                      </th>
                    )}
                    <SortHeader label="Group" k="name" sort={sort} onSort={onSort} className="pl-4" />
                    <SortHeader label="Alerts" k="alerts" sort={sort} onSort={onSort} className="text-right" />
                    <SortHeader label="Priority" k="priority" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
                    <SortHeader label="Score" k="score" sort={sort} onSort={onSort} className="hidden text-right md:table-cell" title="Highest final score in the group" />
                    <SortHeader label="Next deadline" k="deadline" sort={sort} onSort={onSort} className="hidden lg:table-cell" />
                    <SortHeader label="Owner" k="owner" sort={sort} onSort={onSort} />
                    <th className="w-10 px-2 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.length === 0 && (
                    <tr><td colSpan={canEdit ? 8 : 7} className="px-4 py-10 text-center text-slate-500">No groups match these filters.</td></tr>
                  )}
                  {rows.map((g) => {
                    const open = isOpen(g.id);
                    const visibleKids = kids(g.id).length;
                    // Parent groups shown only for context (they don't match the filters themselves) are dimmed
                    const dim = filterActive && !matched.has(g.id);
                    return (
                      <tr
                        key={g.id}
                        onClick={() => setDrawer({ id: g.id, tab: "overview" })}
                        className={`group cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${drawer?.id === g.id || selected.has(g.id) ? "bg-blue-50/60 dark:bg-blue-500/5" : ""}`}
                      >
                        {canEdit && (
                          <td className="w-9 py-2.5 pl-3 pr-0" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${g.title}`}
                              checked={selected.has(g.id)}
                              onChange={(e) => toggleSelect(g.id, e.target.checked)}
                              className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                            />
                          </td>
                        )}
                        <td className="py-2.5 pr-3" style={{ paddingLeft: 10 + (g.depth - 1) * 22 }}>
                          <div className="flex items-center gap-2">
                            {visibleKids > 0 ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggle(g.id); }}
                                aria-label={open ? `Collapse ${g.title}` : `Expand ${g.title}`}
                                aria-expanded={open}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-700"
                              >
                                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            ) : (
                              <span className="w-6 shrink-0" />
                            )}
                            <span className={`hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 sm:flex ${groupColor(g.path[0])}`}>
                              <Layers className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                <span className={`line-clamp-2 break-words ${g.depth === 1 ? "font-semibold" : "font-medium"} ${dim ? "text-slate-500" : "text-slate-900 dark:text-white"}`} title={g.title}>
                                  {g.title}
                                </span>
                                {g.level && (
                                  <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${g.level === "family" ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"}`} title={LEVEL_LABELS[g.level]}>
                                    {g.level === "family" ? "Family" : "Action"}
                                  </span>
                                )}
                                {g.auto_created && <span title="Created by automatic grouping"><Sparkles className="h-3 w-3 shrink-0 text-slate-400" /></span>}
                                {g.needs_review > 0 && (
                                  <span className="shrink-0 rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" title="Grouped by similarity, waiting for confirmation">
                                    {g.needs_review} to review
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                                <GroupLabels group={g} labels={labels} canEdit={canEdit} onApply={(next) => setGroupLabels(g, next)} onCreate={createLabel} />
                                {g.child_count > 0 && <span>{g.child_count} {g.level === "family" ? `action${g.child_count > 1 ? "s" : ""}` : `sub-group${g.child_count > 1 ? "s" : ""}`}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {g.total_count > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDrawer({ id: g.id, tab: "versions" }); }}
                              className="rounded-md px-1.5 py-0.5 font-semibold text-slate-900 hover:bg-blue-50 hover:text-blue-700 dark:text-white dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
                              title="Show the alerts in this group"
                            >
                              {g.total_count}
                            </button>
                          ) : (
                            <span className="px-1.5 text-slate-400">0</span>
                          )}
                        </td>
                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          <div className="flex flex-col items-start gap-1">
                            <PriorityBadge priority={g.highest_priority} />
                            <BandBar byBand={g.by_band} total={g.total_count} className="w-16" />
                          </div>
                        </td>
                        <td className="hidden px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900 md:table-cell dark:text-white">
                          {g.score ?? <span className="font-normal text-slate-400">—</span>}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-slate-600 lg:table-cell dark:text-slate-300">
                          {g.next_deadline ? (
                            <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-slate-400" /> {formatDay(g.next_deadline)}</span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-2 py-2.5 sm:max-w-[11rem] sm:px-3" onClick={(e) => e.stopPropagation()}>
                          <OwnerPicker compact ownerId={g.owner_membership_id} ownerName={g.owner_name} members={members} canAssign={canAssign} onPick={(id) => setOwner(g, id)} />
                        </td>
                        <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <Popover open={menuFor === g.id} onOpenChange={(o) => setMenuFor(o ? g.id : null)}>
                            <PopoverTrigger asChild>
                              <button aria-label={`Actions for ${g.title}`} className="rounded-lg p-1.5 text-slate-400 opacity-70 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-56 p-1.5 text-sm">
                              <button onClick={() => { setMenuFor(null); setDrawer({ id: g.id, tab: "overview" }); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                <Eye className="h-4 w-4 text-slate-500" /> View details
                              </button>
                              <Link href={`/alerts?group_id=${g.id}`} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                <ExternalLink className="h-4 w-4 text-slate-500" /> Open in Alerts
                              </Link>
                              {canEdit && g.depth < MAX_GROUP_DEPTH && (
                                <button onClick={() => { setMenuFor(null); openCreate(g.id); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                  <Plus className="h-4 w-4 text-slate-500" /> {g.level === "family" ? "Add action" : "Add sub-group"}
                                </button>
                              )}
                              {canEdit && (
                                <>
                                  <button onClick={() => { setMenuFor(null); openEdit(g); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                    <Pencil className="h-4 w-4 text-slate-500" /> Edit or move
                                  </button>
                                  {canDelete && <div className="my-1 border-t border-slate-100 dark:border-slate-800" />}
                                  {canDelete && <button onClick={() => { setMenuFor(null); setPendingDelete(g); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                                    <Trash2 className="h-4 w-4" /> Delete
                                  </button>}
                                </>
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

            {/* Pagination (of top-level groups; their sub-groups come with them) */}
            <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
              <span className="text-slate-500">
                {roots.length === 0 ? "No groups" : (
                  <>
                    Showing <span className="font-medium text-slate-900 dark:text-white">{(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, roots.length)}</span> of{" "}
                    <span className="font-medium text-slate-900 dark:text-white">{roots.length}</span> top-level group{roots.length === 1 ? "" : "s"}
                    {filterActive && keep && <> · {keep.size} matching</>}
                  </>
                )}
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  Rows
                  <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-8 rounded-lg border border-slate-200 bg-white px-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-1">
                  <button
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[4.5rem] text-center text-xs text-slate-600 dark:text-slate-300">Page {safePage} of {pageCount}</span>
                  <button
                    disabled={safePage >= pageCount}
                    onClick={() => setPage(safePage + 1)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Group details */}
      {drawerGroup && (
        <GroupDrawer
          key={`${drawerGroup.id}:${drawer!.tab}`}
          group={drawerGroup}
          groups={groups}
          alerts={alerts}
          labels={labels}
          members={members}
          canEdit={canEdit}
          canDelete={canDelete}
          canAssign={canAssign}
          initialTab={drawer!.tab}
          paused={!!openAlert || !!form || !!pendingDelete}
          onClose={() => setDrawer(null)}
          onOpenGroup={(id, tab) => setDrawer({ id, tab: tab ?? "overview" })}
          onOpenAlert={setOpenAlert}
          onEdit={openEdit}
          onAddSub={(g) => openCreate(g.id)}
          onDelete={setPendingDelete}
          onSetOwner={setOwner}
          onSetLabels={setGroupLabels}
          onCreateLabel={createLabel}
          onDecide={(a, d) => decide([{ id: a.id, title: a.title, confidence: 0, basis: "", group_path: drawerGroup.path, priority: null }], d)}
          onChanged={(text) => { setFlash({ ok: true, text }); load(); }}
        />
      )}

      {/* Create / edit */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.mode === "edit" ? "Edit group" : formParent ? (formParent.level === "family" ? "New action" : "New sub-group") : "New group"}</DialogTitle>
            <DialogDescription>{formParent ? <>Inside <strong>{formParent.path.join(" › ")}</strong></> : "Top-level group"}</DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="space-y-4">
              <div>
                <label htmlFor="g-title" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                <input id="g-title" autoFocus required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label htmlFor="g-parent" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Sits inside</label>
                <select id="g-parent" value={form.parent_group_id ?? ""} onChange={(e) => setForm({ ...form, parent_group_id: e.target.value || null })} className={inputCls}>
                  <option value="">— Top level —</option>
                  {parentChoices.map(({ g, disabled }) => (
                    <option key={g.id} value={g.id} disabled={disabled}>
                      {"  ".repeat(g.depth - 1)}{g.depth > 1 ? "└ " : ""}{g.title}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">Up to {MAX_GROUP_DEPTH} levels. Greyed-out groups would make the tree too deep{form.mode === "edit" ? " or are inside this group" : ""}.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="g-jur" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Jurisdiction</label>
                  <input id="g-jur" value={form.jurisdiction_ref} onChange={(e) => setForm({ ...form, jurisdiction_ref: e.target.value })} placeholder="e.g. United States" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="g-iss" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Issuing authority</label>
                  <input id="g-iss" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder="e.g. EPA" className={inputCls} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="g-level" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Level</label>
                  <select id="g-level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as FormState["level"] })} className={inputCls}>
                    <option value="family">Regulatory family (level 1)</option>
                    <option value="action">Regulatory action (level 2)</option>
                    <option value="">Free-form group</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="g-key" className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-300">
                    {form.level === "action" ? "Action key" : "Family key"}
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, group_key: suggestKey(form.jurisdiction_ref, form.issuer, form.title, form.level === "action" ? formParent?.group_key : null) })}
                      className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Suggest
                    </button>
                  </label>
                  <input id="g-key" value={form.group_key} onChange={(e) => setForm({ ...form, group_key: e.target.value.toUpperCase() })} placeholder={form.level === "action" ? "US-EPA-AIM_ACT-ALLOCATIONS" : "US-EPA-AIM_ACT"} className={`${inputCls} font-mono`} />
                </div>
              </div>
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Labels</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {labels.map((l) => {
                    const on = form.labels.some((x) => x.toLowerCase() === l.name.toLowerCase());
                    return (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setForm({ ...form, labels: on ? form.labels.filter((x) => x.toLowerCase() !== l.name.toLowerCase()) : [...form.labels, l.name] })}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${on ? LABEL_STYLE[l.color] || LABEL_STYLE.slate : "text-slate-500 ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800"}`}
                      >
                        {on && <CheckCircle2 className="h-3 w-3" />} {l.name}
                      </button>
                    );
                  })}
                  <span className="inline-flex items-center gap-1">
                    <input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value.slice(0, 40))}
                      onKeyDown={async (e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const name = await createLabel(newLabel);
                        if (name) {
                          setForm((f) => (f ? { ...f, labels: f.labels.some((x) => x.toLowerCase() === name.toLowerCase()) ? f.labels : [...f.labels, name] } : f));
                          setNewLabel("");
                        }
                      }}
                      placeholder="New label…"
                      aria-label="New label"
                      className="h-7 w-28 rounded-full border border-dashed border-slate-300 bg-transparent px-2.5 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-600"
                    />
                    <button
                      type="button"
                      disabled={!newLabel.trim()}
                      onClick={async () => {
                        const name = await createLabel(newLabel);
                        if (name) {
                          setForm((f) => (f ? { ...f, labels: f.labels.some((x) => x.toLowerCase() === name.toLowerCase()) ? f.labels : [...f.labels, name] } : f));
                          setNewLabel("");
                        }
                      }}
                      className="rounded-full p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                      aria-label="Add label"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              </div>
              <div>
                <label htmlFor="g-ids" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Identifiers</label>
                <input
                  id="g-ids"
                  value={form.identifiers_text}
                  onChange={(e) => setForm({ ...form, identifiers_text: e.target.value })}
                  placeholder="e.g. RIN 2060-AV12, EPA-HQ-OAR-2021-0643, 40 CFR 84, SB 1215"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-slate-500">Alerts carrying any of these join this group automatically. Bill numbers use the jurisdiction above.</p>
              </div>
              <div>
                <label htmlFor="g-desc" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
                <textarea id="g-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
              </div>
              {formError && (
                <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                  <X className="h-4 w-4" /> {formError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setForm(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                <button type="submit" disabled={saving || !form.title.trim()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {form.mode === "edit" ? "Save" : "Create"}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {openAlert && <AlertDrawer alertId={openAlert} onClose={() => setOpenAlert(null)} onChanged={() => { load(); loadReview(); }} />}

      {/* Delete */}
      <AiGroupingDialog
        open={aiOpen}
        isAdmin={role === "company_admin"}
        onClose={() => setAiOpen(false)}
        onApplied={() => {
          void load();
          void loadReview();
        }}
      />

      <ConfirmDialog
        open={bulkDelete}
        title={`Delete ${topSelected.length} group${topSelected.length === 1 ? "" : "s"}?`}
        description={(() => {
          const subs = topSelected.reduce((n, g) => n + g.child_count, 0);
          const moving = topSelected.reduce((n, g) => n + g.total_count, 0);
          return (
            <>
              <span className="block max-h-32 overflow-y-auto">
                {topSelected.map((g) => <span key={g.id} className="block truncate">• {g.path.join(" › ")}</span>)}
              </span>
              <span className="mt-2 block">
                {subs > 0 && <>Their sub-groups are deleted too. </>}
                {moving > 0 ? (
                  <>The <strong>{moving} alert{moving === 1 ? "" : "s"}</strong> inside move up to each group&apos;s parent (or to No group). Alerts themselves are not deleted.</>
                ) : (
                  <>No alerts are affected.</>
                )}
              </span>
            </>
          );
        })()}
        confirmLabel="Delete groups"
        onClose={() => setBulkDelete(false)}
        onConfirm={async () => {
          const list = topSelected;
          const comment = await askChangeComment({ action: `Delete ${list.length} group${list.length === 1 ? "" : "s"}`, detail: list.map((g) => g.title).join(", ").slice(0, 200) });
          if (!comment) return;
          // Close the details panel if its group is being deleted (directly or as a sub-group)
          if (drawer) {
            for (let p: string | null = drawer.id; p; p = byId.get(p)?.parent_group_id ?? null) {
              if (list.some((g) => g.id === p)) {
                setDrawer(null);
                break;
              }
            }
          }
          await runBulk("Deleted", list, (g) => fetch(`/api/groups/${g.id}`, { method: "DELETE", headers: commentHeader(comment) }));
          setSelected(new Set());
        }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete “${pendingDelete?.title ?? ""}”?`}
        description={
          pendingDelete && (
            <>
              {pendingDelete.child_count > 0 && <>Its sub-groups are deleted too. </>}
              {pendingDelete.total_count > 0 ? (
                <>
                  The <strong>{pendingDelete.total_count} alert{pendingDelete.total_count > 1 ? "s" : ""}</strong> inside will move to{" "}
                  <strong>{pendingDelete.parent_group_id ? byId.get(pendingDelete.parent_group_id)?.path.join(" › ") : "No group"}</strong>. Alerts themselves are not deleted.
                </>
              ) : (
                <>No alerts are affected.</>
              )}
            </>
          )
        }
        confirmLabel="Delete group"
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const g = pendingDelete!;
          const comment = await askChangeComment({ action: `Delete group ${g.path.join(" › ")}`, detail: g.total_count ? `${g.total_count} alerts move up a level` : undefined });
          if (!comment) return;
          const res = await fetch(`/api/groups/${g.id}`, { method: "DELETE", headers: commentHeader(comment) });
          setFlash(res.ok ? { ok: true, text: `Deleted “${g.title}”` } : { ok: false, text: "Could not delete group" });
          if (res.ok && drawer?.id === g.id) setDrawer(null);
          await load();
        }}
      />

    </div>
  );
}
