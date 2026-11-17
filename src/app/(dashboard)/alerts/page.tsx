"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityBadge, type Priority } from "@/components/dashboard/priority-badge";
import { FilterBar, type FilterState, emptyFilters } from "@/components/dashboard/filter-bar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AlertDrawer } from "@/components/alerts/alert-drawer";

interface Alert {
  id: string;
  external_alert_id: string;
  title: string;
  stage: string;
  jurisdiction_raw: string;
  product_raw: string;
  source_name: string;
  source_url: string;
  next_compliance_deadline: string | null;
  days_remaining: number | null;
  effective_total: number | null;
  effective_priority: string;
  primary_group_title: string | null;
  owner_name: string | null;
  local_state: string;
}

export default function AlertsPage() {
  const searchParams = useSearchParams();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "25");
    params.set("sort", sortBy);
    params.set("dir", sortDir);
    if (filters.search) params.set("search", filters.search);
    if (filters.priorities?.length) params.set("priority", filters.priorities.join(","));
    if (filters.stages?.length) params.set("stage", filters.stages.join(","));
    if (filters.countries?.length) params.set("geography", filters.countries.join(","));

    try {
      const res = await fetch(`/api/alerts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
        setTotal(data.pagination?.total ?? data.total ?? 0);
      }
    } catch (e) {
      console.error("Failed to fetch alerts", e);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortDir, filters]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  useEffect(() => {
    const priority = searchParams.get("priority");
    const geo = searchParams.get("geography");
    if (priority || geo) {
      const f: FilterState = { ...emptyFilters };
      if (priority) f.priorities = [priority];
      if (geo) f.countries = [geo];
      setFilters(f);
    }
  }, [searchParams]);

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  const totalPages = Math.ceil(total / 25);

  const sortIcon = (col: string) => {
    if (sortBy !== col) return null;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Alerts</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Regulatory alerts from Daptic feed
          </p>
        </div>
      </div>

      <FilterBar filters={filters} onFiltersChange={setFilters} matchCount={total} />

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-[var(--muted)]/50">
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:bg-[var(--muted)]" onClick={() => handleSort("title")}>
                  Alert {sortIcon("title")}
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:bg-[var(--muted)]" onClick={() => handleSort("stage")}>
                  Stage {sortIcon("stage")}
                </th>
                <th className="text-left px-4 py-3 font-medium">Geography</th>
                <th className="text-left px-4 py-3 font-medium">Products</th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:bg-[var(--muted)]" onClick={() => handleSort("deadline")}>
                  Deadline {sortIcon("deadline")}
                </th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer hover:bg-[var(--muted)]" onClick={() => handleSort("score")}>
                  Score {sortIcon("score")}
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:bg-[var(--muted)]" onClick={() => handleSort("priority")}>
                  Priority {sortIcon("priority")}
                </th>
                <th className="text-left px-4 py-3 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : alerts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--muted-foreground)]">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No alerts found</p>
                    <p className="text-xs mt-1">Try adjusting your filters or import alerts from the Imports page</p>
                  </td>
                </tr>
              ) : (
                alerts.map((alert) => (
                  <tr
                    key={alert.id}
                    className="border-b hover:bg-[var(--muted)]/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedAlert(alert.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{alert.title}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">{alert.external_alert_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">{alert.stage || "—"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">{alert.jurisdiction_raw || "—"}</td>
                    <td className="px-4 py-3 text-xs max-w-[150px] truncate">{alert.product_raw || "—"}</td>
                    <td className="px-4 py-3">
                      {alert.next_compliance_deadline ? (
                        <div>
                          <div className="text-xs">{new Date(alert.next_compliance_deadline).toLocaleDateString()}</div>
                          <div className={`text-xs font-medium ${
                            alert.days_remaining !== null && alert.days_remaining <= 30
                              ? "text-[var(--priority-critical)]"
                              : alert.days_remaining !== null && alert.days_remaining <= 180
                              ? "text-[var(--priority-moderate)]"
                              : "text-[var(--muted-foreground)]"
                          }`}>
                            {alert.days_remaining !== null
                              ? alert.days_remaining < 0
                                ? `${Math.abs(alert.days_remaining)}d overdue`
                                : `${alert.days_remaining}d left`
                              : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">{"—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {alert.effective_total !== null ? (
                        <span className="font-mono text-sm">{alert.effective_total}</span>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">Unscored</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={(alert.effective_priority || "unscored") as Priority} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {alert.owner_name || <span className="text-[var(--muted-foreground)]">Unassigned</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--muted-foreground)]">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <Sheet open={!!selectedAlert} onOpenChange={() => setSelectedAlert(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 overflow-y-auto">
          {selectedAlert && (
            <AlertDrawer alertId={selectedAlert} onClose={() => setSelectedAlert(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
