"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, X, ChevronDown, Check, Upload, Plus, Tag, ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { ConfirmDialog, deleteAlertsRequest } from "@/components/alerts/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDrawer } from "@/components/alerts/alert-drawer";
import { AlertsTable, type AlertRow, groupColor, createGroup, MAX_GROUP_DEPTH } from "@/components/alerts/alerts-table";
import { useSessionInfo } from "@/components/layout/session-context";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";

interface Option { value: string; label: string; count?: number }
interface GroupOption extends Option { parent: string | null; depth: number; path: string[] }
interface Facets {
  stages: Option[];
  countries: Option[];
  groups: GroupOption[];
  ungrouped_count: number;
  owners: Option[];
  unassigned_count: number;
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
}

const EMPTY: Filters = { search: "", priorities: [], stages: [], countries: [], owner: null, group: null, deadline: null, needsReview: false };

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

function FacetSelect({
  label,
  options,
  selected,
  onChange,
  multi = true,
  searchable = false,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (v: string[]) => void;
  multi?: boolean;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = searchable && q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const active = selected.length > 0;
  const summary = active
    ? selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || selected[0]
      : `${selected.length} selected`
    : null;
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
        <div className="max-h-64 overflow-y-auto">
          {shown.length === 0 && <p className="px-2.5 py-3 text-sm text-slate-500">No options</p>}
          {shown.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                onClick={() => onChange(multi ? (on ? selected.filter((v) => v !== o.value) : [...selected, o.value]) : on ? [] : [o.value])}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded ${multi ? "" : "rounded-full"} border ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.count !== undefined && <span className="text-xs tabular-nums text-slate-400">{o.count}</span>}
              </button>
            );
          })}
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
  const canEdit = !!role && role !== "risk_owner";
  const workspaceWide = hasCompanyWideAccess(role ?? "", session?.membership.access_scope ?? "");
  const isAdmin = role === "company_admin";
  const canDelete = role === "company_admin" || role === "manager";
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
    group: searchParams.get("group_id"),
    owner: searchParams.get("owner_id"),
  }));
  const [searchInput, setSearchInput] = useState("");
  const [facets, setFacets] = useState<Facets | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
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
          setTotal(data.pagination?.total ?? 0);
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
      setSortDir(col === "title" ? "asc" : "desc");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeCount =
    filters.priorities.length + filters.stages.length + filters.countries.length +
    (filters.owner ? 1 : 0) + (filters.group ? 1 : 0) + (filters.deadline ? 1 : 0) + (filters.search ? 1 : 0) + (filters.needsReview ? 1 : 0);

  const allCount = useMemo(() => (facets ? Object.values(facets.priorities).reduce((a, b) => a + b, 0) : null), [facets]);

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    const title = newGroupName.trim();
    if (!title) return;
    try {
      // Created inside the group being viewed, as long as that stays within the depth limit
      const g = await createGroup(title, currentGroup && currentGroup.depth < MAX_GROUP_DEPTH ? currentGroup.value : null);
      setNewGroupName("");
      setCreatingGroup(false);
      loadFacets();
      update({ group: g.id });
    } catch {
      /* creation errors surface on next try */
    }
  }

  // Group drill-down: breadcrumb of the selected group's ancestors, then its sub-groups
  const groupList = facets?.groups || [];
  const currentGroup = filters.group && filters.group !== "none" ? groupList.find((g) => g.value === filters.group) || null : null;
  const trail: GroupOption[] = [];
  for (let g = currentGroup; g; g = g.parent ? groupList.find((x) => x.value === g!.parent) || null : null) trail.unshift(g);
  const childGroups = groupList.filter((g) => g.parent === (currentGroup?.value ?? null));
  const hasChildren = (id: string) => groupList.some((g) => g.parent === id);
  const canNest = !currentGroup || currentGroup.depth < MAX_GROUP_DEPTH;

  const groupChip = (value: string | null, label: string, count: number | undefined, colorKey?: string, nested = false) => {
    const on = filters.group === value;
    return (
      <button
        key={value ?? "all"}
        onClick={() => update({ group: value })}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-all ${
          on
            ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white"
            : colorKey
            ? `${groupColor(colorKey)} hover:brightness-95`
            : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
        }`}
      >
        {colorKey && <Tag className="h-3 w-3" />}
        {label}
        {count !== undefined && <span className={`tabular-nums ${on ? "opacity-80" : "opacity-60"}`}>{count}</span>}
        {nested && <ChevronRight className="-mr-1 h-3 w-3 opacity-60" aria-label="has sub-groups" />}
      </button>
    );
  };

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
          {isAdmin && (allCount ?? 0) > 0 && (
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

        {/* Group labels */}
        {workspaceWide && <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <span className="mr-1 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Groups</span>
          {groupChip(null, "All", undefined)}
          {trail.map((g) => (
            <React.Fragment key={g.value}>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />
              {groupChip(g.value, g.label, g.count, g.path[0])}
            </React.Fragment>
          ))}
          {currentGroup && childGroups.length > 0 && (
            <span className="ml-1 mr-0.5 h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden />
          )}
          {childGroups.map((g) => groupChip(g.value, g.label, g.count, g.path[0], hasChildren(g.value)))}
          {!currentGroup && facets && facets.ungrouped_count > 0 && groupChip("none", "No group", facets.ungrouped_count)}
          {canEdit &&
            (creatingGroup ? (
              <form onSubmit={handleCreateGroup} className="flex shrink-0 items-center gap-1">
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onBlur={() => !newGroupName && setCreatingGroup(false)}
                  placeholder={currentGroup && canNest ? `Sub-group of ${currentGroup.label}` : "Group name"}
                  className="h-8 w-56 rounded-full border border-slate-300 bg-white px-3 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900"
                />
                <button type="submit" className="h-8 rounded-full bg-blue-600 px-3 text-xs font-semibold text-white">Create</button>
              </form>
            ) : (
              <button
                onClick={() => setCreatingGroup(true)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600 dark:border-slate-600"
              >
                <Plus className="h-3 w-3" /> {currentGroup && canNest ? "New sub-group" : "New group"}
              </button>
            ))}
        </div>}

        {/* More filters */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {workspaceWide && <><FacetSelect label="Stage" options={facets?.stages || []} selected={filters.stages} onChange={(v) => update({ stages: v })} />
          <FacetSelect label="Country" options={facets?.countries || []} selected={filters.countries} onChange={(v) => update({ countries: v })} searchable />
          <FacetSelect
            label="Owner"
            multi={false}
            options={[{ value: "unassigned", label: "Unassigned", count: facets?.unassigned_count }, ...(facets?.owners || [])]}
            selected={filters.owner ? [filters.owner] : []}
            onChange={(v) => update({ owner: v[0] ?? null })}
          /></>}
          <FacetSelect
            label="Deadline"
            multi={false}
            options={DEADLINE_OPTIONS}
            selected={filters.deadline ? [filters.deadline] : []}
            onChange={(v) => update({ deadline: v[0] ?? null })}
          />
          {filters.needsReview && (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-50 px-3 text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              Needs review
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
