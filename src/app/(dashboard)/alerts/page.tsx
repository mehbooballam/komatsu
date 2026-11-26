"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, X, ChevronDown, Check, Upload, Plus, Tag, ChevronLeft, ChevronRight, Loader2, Trash2, Eye } from "lucide-react";
import { ConfirmDialog, deleteAlertsRequest } from "@/components/alerts/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDrawer } from "@/components/alerts/alert-drawer";
import { AlertsTable, type AlertRow, createGroup, MAX_GROUP_DEPTH } from "@/components/alerts/alerts-table";
import { useSessionInfo } from "@/components/layout/session-context";
import { canMakeChanges, hasCompanyWideAccess } from "@/lib/auth/permissions";
import { isDeleteAllowed } from "@/lib/delete-settings";

interface Option { value: string; label: string; count?: number }
interface GroupOption extends Option { parent: string | null; depth: number; path: string[] }
interface Facets {
  stages: Option[];
  /** All continents, then countries with alerts */
  continents?: Option[];
  countries: Option[];
  groups: GroupOption[];
  ungrouped_count: number;
  owners: Option[];
  unassigned_count: number;
  human_review_count?: number;
  products?: Option[];
  priorities: Record<string, number>;
}

interface Filters {
  search: string;
  priorities: string[];
  stages: string[];
  countries: string[];
  owner: string | null;
  group: string | null;
  deadline: string | null;
  needsReview: boolean;
  /** Flagged for human review (import column or by a person) */
  humanReview: boolean;
  /** "family:<id>" / "model:<id>" */
  products: string[];
  /** One jurisdiction as written in the feed (from the dashboard map) */
  jurisdiction: string | null;
}

const EMPTY: Filters = { search: "", priorities: [], stages: [], countries: [], owner: null, group: null, deadline: null, needsReview: false, humanReview: false, products: [], jurisdiction: null };

const PRIORITY_PILLS = [
  { value: "critical", label: "Critical", dot: "bg-violet-500" },
  { value: "high", label: "High", dot: "bg-orange-500" },
  { value: "moderate", label: "Moderate", dot: "bg-amber-400" },
  { value: "low", label: "Low", dot: "bg-teal-400" },
];

const DEADLINE_OPTIONS: Option[] = [
  { value: "overdue", label: "Overdue" },
  { value: "30", label: "Within 30 days" },
  { value: "90", label: "Within 90 days" },
  { value: "180", label: "Within 6 months" },
  { value: "365", label: "Within 1 year" },
  { value: "none", label: "No deadline" },
];

const PAGE_SIZE = 25;

/** Group filter: searchable dropdown, groups as a tree (sub-groups indented), plus "Not grouped". */
function GroupSelect({
  groups,
  ungroupedCount,
  value,
  onChange,
  canCreate,
  onCreate,
}: {
  groups: GroupOption[];
  ungroupedCount: number | undefined;
  value: string | null;
  onChange: (v: string | null) => void;
  canCreate: boolean;
  onCreate: (title: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Tree order: each group followed by its sub-groups
  const ordered = useMemo(() => {
    const kids = new Map<string | null, GroupOption[]>();
    for (const g of groups) {
      const k = g.parent ?? null;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k)!.push(g);
    }
    for (const list of kids.values()) list.sort((a, b) => a.label.localeCompare(b.label));
    const out: GroupOption[] = [];
    const walk = (p: string | null) => {
      for (const g of kids.get(p) ?? []) {
        out.push(g);
        walk(g.value);
      }
    };
    walk(null);
    // Orphans (parent not in the list) at the end
    for (const g of groups) if (!out.includes(g)) out.push(g);
    return out;
  }, [groups]);
  const term = q.trim().toLowerCase();
  const shown = term ? ordered.filter((g) => g.path.join(" › ").toLowerCase().includes(term)) : ordered;
  const current = value && value !== "none" ? groups.find((g) => g.value === value) : null;
  const summary = value === "none" ? "Not grouped" : current ? current.path.join(" › ") : null;
  // "Not grouped" is always offered (also when searching for it)
  const showUngrouped = !term || "not grouped".includes(term) || "ungrouped".includes(term) || "no group".includes(term);
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };
  const row = (key: string, label: React.ReactNode, on: boolean, onClick: () => void, count?: number, depth = 0, title?: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${on ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : ""}`}
      style={{ paddingLeft: 10 + depth * 14 }}
    >
      {depth > 0 && <span className="h-px w-2 shrink-0 bg-slate-300 dark:bg-slate-600" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="shrink-0 text-xs tabular-nums text-slate-400">{count}</span>}
      {on && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex h-9 max-w-[22rem] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
            summary
              ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          }`}
          title={summary ?? undefined}
        >
          <Tag className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="shrink-0 text-slate-500 dark:text-slate-400">Group{summary ? ":" : ""}</span>
          {summary && <span className="min-w-0 truncate">{summary}</span>}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] max-w-[calc(100vw-2rem)] p-1.5">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${groups.length} groups…`}
            aria-label="Search groups"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {!term && row("all", "All groups", value === null, () => pick(null))}
          {showUngrouped && row("none", <span className="italic">Not grouped</span>, value === "none", () => pick("none"), ungroupedCount ?? 0, 0, "Alerts that are not in any group")}
          {!term && groups.length > 0 && <div role="separator" className="my-1 border-t border-slate-100 dark:border-slate-800" />}
          {shown.map((g) =>
            row(
              g.value,
              term ? g.path.join(" › ") : g.label,
              value === g.value,
              () => pick(g.value),
              g.count,
              term ? 0 : Math.max(0, g.depth - 1),
              g.path.join(" › ")
            )
          )}
          {shown.length === 0 && !showUngrouped && <p className="px-2.5 py-3 text-sm text-slate-500">No group matches “{q}”.</p>}
        </div>
        {canCreate && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setBusy(true);
              await onCreate(name.trim());
              setBusy(false);
              setName("");
              setOpen(false);
            }}
            className="mt-1 flex gap-1.5 border-t border-slate-100 px-1 pt-2 dark:border-slate-800"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={current ? `New sub-group of ${current.label}` : "New group"}
              aria-label="New group name"
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
            />
            <button type="submit" disabled={busy || !name.trim()} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              <Plus className="h-3 w-3" /> Create
            </button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FacetSelect({
  label,
  options,
  selected,
  onChange,
  multi = true,
  searchable = false,
  leading,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (v: string[]) => void;
  multi?: boolean;
  searchable?: boolean;
  /** Options shown first under their own heading, then a divider (e.g. continents before countries) */
  leading?: { title: string; optionsTitle: string; options: Option[] };
}) {
  const [q, setQ] = useState("");
  const match = (o: Option) => !(searchable && q) || o.label.toLowerCase().includes(q.toLowerCase());
  const shown = options.filter(match);
  const shownLeading = leading ? leading.options.filter(match) : [];
  const active = selected.length > 0;
  const allOptions = leading ? [...leading.options, ...options] : options;
  const summary = active
    ? selected.length === 1
      ? allOptions.find((o) => o.value === selected[0])?.label || selected[0]
      : `${selected.length} selected`
    : null;
  const renderOption = (o: Option) => {
    const on = selected.includes(o.value);
    const empty = o.count === 0 && !on;
    return (
      <button
        key={o.value}
        onClick={() => onChange(multi ? (on ? selected.filter((v) => v !== o.value) : [...selected, o.value]) : on ? [] : [o.value])}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${empty ? "text-slate-400 dark:text-slate-500" : ""}`}
      >
        <span className={`flex h-4 w-4 items-center justify-center rounded ${multi ? "" : "rounded-full"} border ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
          {on && <Check className="h-3 w-3" />}
        </span>
        <span className="flex-1 truncate">{o.label}</span>
        {o.count !== undefined && <span className="text-xs tabular-nums text-slate-400">{o.count}</span>}
      </button>
    );
  };
  const heading = (t: string) => (
    <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t}</p>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
            active
              ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          }`}
        >
          <span className="text-slate-500 dark:text-slate-400">{label}{summary ? ":" : ""}</span>
          {summary && <span className="max-w-[140px] truncate">{summary}</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        {searchable && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="mb-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        )}
        <div className="max-h-80 overflow-y-auto">
          {shown.length === 0 && shownLeading.length === 0 && <p className="px-2.5 py-3 text-sm text-slate-500">No options</p>}
          {shownLeading.length > 0 && leading && (
            <>
              {heading(leading.title)}
              {shownLeading.map(renderOption)}
              {shown.length > 0 && <div role="separator" className="my-1.5 border-t border-slate-200 dark:border-slate-700" />}
              {shown.length > 0 && heading(leading.optionsTitle)}
            </>
          )}
          {shown.map(renderOption)}
        </div>
        {active && (
          <button onClick={() => onChange([])} className="mt-1 w-full rounded-lg border-t border-slate-100 px-2.5 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function AlertsPage() {
  const searchParams = useSearchParams();
  const session = useSessionInfo();
  const role = session?.membership.role;
  // Reviewers and risk owners can only look
  const canEdit = canMakeChanges(role);
  const workspaceWide = hasCompanyWideAccess(role ?? "", session?.membership.access_scope ?? "");
  const isAdmin = role === "company_admin";
  // Deleting alerts is switched on or off in Settings › Workspace
  const deleteOn = isDeleteAllowed(session?.company.settings, "alerts");
  const canDelete = deleteOn && (role === "company_admin" || role === "manager");
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [alsoImports, setAlsoImports] = useState(true);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY,
    priorities: searchParams.get("priority")?.split(",").filter(Boolean) ?? [],
    countries: searchParams.get("geography")?.split(",").filter(Boolean) ?? [],
    deadline: searchParams.get("deadline_within"),
    needsReview: searchParams.get("needs_review") === "true",
    humanReview: searchParams.get("human_review") === "true",
    products: searchParams.get("product")?.split(",").filter(Boolean) ?? [],
    jurisdiction: searchParams.get("jurisdiction"),
    group: searchParams.get("group_id"),
    owner: searchParams.get("owner_id"),
  }));
  const [searchInput, setSearchInput] = useState("");
  const [facets, setFacets] = useState<Facets | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [refreshKey, setRefreshKey] = useState(0);

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadFacets = useCallback(() => {
    if (!workspaceWide) return;
    fetch("/api/alerts/facets").then((r) => (r.ok ? r.json() : null)).then((d) => d && setFacets(d));
  }, [workspaceWide]);
  useEffect(() => { loadFacets(); }, [loadFacets, refreshKey]);

  // Query string for the current page/sort/filters; refetches whenever it changes
  const alertsQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("per_page", String(PAGE_SIZE));
    params.set("sort", sortBy);
    params.set("dir", sortDir);
    if (filters.search) params.set("search", filters.search);
    if (filters.priorities.length) params.set("priority", filters.priorities.join(","));
    if (filters.stages.length) params.set("stage", filters.stages.join(","));
    if (filters.countries.length) params.set("geography", filters.countries.join(","));
    if (filters.owner) params.set("owner_id", filters.owner);
    if (filters.group) params.set("group_id", filters.group);
    if (filters.deadline) params.set("deadline_within", filters.deadline);
    if (filters.needsReview) params.set("needs_review", "true");
    if (filters.humanReview) params.set("human_review", "true");
    if (filters.products.length) params.set("product", filters.products.join(","));
    if (filters.jurisdiction) params.set("jurisdiction", filters.jurisdiction);
    return params.toString();
  }, [page, sortBy, sortDir, filters]);

  // "Loading" = the results shown are not yet for the current query (no setState needed to start a fetch)
  const requestKey = `${alertsQuery}#${refreshKey}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/alerts?${alertsQuery}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setAlerts(data.alerts || []);
          const nextTotal = data.pagination?.total ?? 0;
          setTotal(nextTotal);
          setPage((current) => Math.min(current, Math.max(1, Math.ceil(nextTotal / PAGE_SIZE))));
        }
        setLoadedKey(`${alertsQuery}#${refreshKey}`);
      });
    return () => {
      cancelled = true;
    };
  }, [alertsQuery, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortBy(col);
      setSortDir(col === "title" || col === "stage" ? "asc" : "desc");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeCount =
    filters.priorities.length + filters.stages.length + filters.countries.length +
    (filters.owner ? 1 : 0) + (filters.group ? 1 : 0) + (filters.deadline ? 1 : 0) + (filters.search ? 1 : 0) + (filters.needsReview ? 1 : 0) + (filters.humanReview ? 1 : 0) + filters.products.length + (filters.jurisdiction ? 1 : 0);

  const allCount = useMemo(() => (facets ? Object.values(facets.priorities).reduce((a, b) => a + b, 0) : null), [facets]);

  async function createGroupNamed(title: string) {
    try {
      // Created inside the selected group, as long as that stays within the depth limit
      const g = await createGroup(title, currentGroup && currentGroup.depth < MAX_GROUP_DEPTH ? currentGroup.value : null);
      loadFacets();
      update({ group: g.id });
    } catch {
      /* creation errors surface on next try */
    }
  }

  const groupList = facets?.groups || [];
  const currentGroup = filters.group && filters.group !== "none" ? groupList.find((g) => g.value === filters.group) || null : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Alerts</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Review, prioritise, group and assign regulatory alerts.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {deleteOn && isAdmin && (allCount ?? 0) > 0 && (
            <button
              onClick={() => setDeleteAllOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" /> Delete all
            </button>
          )}
          <Link
            href="/imports"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700"
          >
            <Upload className="h-4 w-4" /> Import alerts
          </Link>
        </div>
      </div>

      <ConfirmDialog
        open={deleteAllOpen}
        title="Delete all alerts?"
        description={
          <>
            This permanently deletes <strong>all {allCount ?? ""} alerts</strong> in this workspace, including scores, deadlines,
            assignments and group links. Groups, team members and settings are kept.
          </>
        }
        requireText="DELETE"
        confirmLabel="Delete everything"
        onClose={() => setDeleteAllOpen(false)}
        onConfirm={async () => {
          await deleteAlertsRequest({ all: true, confirm: "DELETE", include_imports: alsoImports });
          setPage(1);
          refresh();
        }}
      >
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={alsoImports} onChange={(e) => setAlsoImports(e.target.checked)} className="h-4 w-4 accent-red-600" />
          Also clear import history
        </label>
      </ConfirmDialog>

      <div className="panel overflow-hidden">
        {/* Search + priority pills */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center dark:border-slate-800">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by title, ID or keyword…"
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
            />
            {searchInput && (
              <button onClick={() => setSearchInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => update({ priorities: [] })}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${filters.priorities.length === 0 ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
            >
              All {allCount !== null && <span className="ml-0.5 opacity-70">{allCount}</span>}
            </button>
            {PRIORITY_PILLS.map((p) => {
              const on = filters.priorities.includes(p.value);
              return (
                <button
                  key={p.value}
                  onClick={() => update({ priorities: on ? filters.priorities.filter((x) => x !== p.value) : [...filters.priorities, p.value] })}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ring-1 transition-colors ${
                    on ? "bg-white ring-blue-500 text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "ring-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${p.dot}`} />
                  {p.label}
                  {facets && <span className="tabular-nums text-xs opacity-60">{facets.priorities[p.value] ?? 0}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* More filters */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {workspaceWide && (
            <GroupSelect
              groups={groupList}
              ungroupedCount={facets?.ungrouped_count}
              value={filters.group}
              onChange={(v) => update({ group: v })}
              canCreate={canEdit}
              onCreate={createGroupNamed}
            />
          )}
          {workspaceWide && <><FacetSelect label="Stage" options={facets?.stages || []} selected={filters.stages} onChange={(v) => update({ stages: v })} />
          <FacetSelect
            label="Country"
            leading={facets?.continents?.length ? { title: "Continents", optionsTitle: "Countries", options: facets.continents } : undefined}
            options={facets?.countries || []}
            selected={filters.countries}
            onChange={(v) => update({ countries: v })}
            searchable
          />
          <FacetSelect
            label="Owner"
            multi={false}
            options={[{ value: "unassigned", label: "Unassigned", count: facets?.unassigned_count }, ...(facets?.owners || [])]}
            selected={filters.owner ? [filters.owner] : []}
            onChange={(v) => update({ owner: v[0] ?? null })}
          /></>}
          {workspaceWide && (
            <FacetSelect
              label="Product"
              options={facets?.products || []}
              selected={filters.products}
              onChange={(v) => update({ products: v })}
              searchable
            />
          )}
          <FacetSelect
            label="Deadline"
            multi={false}
            options={DEADLINE_OPTIONS}
            selected={filters.deadline ? [filters.deadline] : []}
            onChange={(v) => update({ deadline: v[0] ?? null })}
          />
          <button
            type="button"
            aria-pressed={filters.humanReview}
            onClick={() => update({ humanReview: !filters.humanReview })}
            title="Alerts flagged for human review — by the import file's needs_human_review column or by a person"
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
              filters.humanReview
                ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            }`}
          >
            <Eye className="h-3.5 w-3.5 opacity-70" />
            Needs review
            {facets?.human_review_count != null && (
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${facets.human_review_count > 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
                {facets.human_review_count}
              </span>
            )}
          </button>
          {filters.jurisdiction && (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-50 px-3 text-sm font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
              {filters.jurisdiction}
              <button onClick={() => update({ jurisdiction: null })} aria-label="Remove jurisdiction filter"><X className="h-3.5 w-3.5" /></button>
            </span>
          )}
          {filters.needsReview && (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-sm font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Incomplete scores
              <button onClick={() => update({ needsReview: false })} aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
            </span>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <span className="text-slate-500">
              <span className="font-semibold text-slate-900 dark:text-white">{total}</span> alert{total === 1 ? "" : "s"}
            </span>
            {activeCount > 0 && (
              <button
                onClick={() => {
                  setSearchInput("");
                  update({ ...EMPTY });
                }}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800"
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="px-2 pb-2">
          <AlertsTable
            alerts={alerts}
            loading={loading && alerts.length === 0}
            onOpen={setSelectedAlert}
            onChanged={refresh}
            selectable={canEdit}
            canEdit={canEdit}
            canDelete={canDelete}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
            onGroupClick={workspaceWide ? (id) => update({ group: id }) : undefined}
            emptyMessage={
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-300">No alerts match these filters</p>
                <p className="mt-1 text-xs">Try clearing some filters, or import alerts from the Imports page.</p>
              </div>
            }
          />
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
            <span className="text-slate-500">
              Showing <span className="font-medium text-slate-900 dark:text-white">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</span> of{" "}
              <span className="font-medium text-slate-900 dark:text-white">{total}</span>
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                .map((n, i, arr) => (
                  <React.Fragment key={n}>
                    {i > 0 && n - arr[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
                    <button
                      onClick={() => setPage(n)}
                      className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium ${n === page ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                    >
                      {n}
                    </button>
                  </React.Fragment>
                ))}
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedAlert && (
        <AlertDrawer
          alertId={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
