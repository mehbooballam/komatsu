"use client";

import React, { useEffect, useState, useCallback } from "react";
import { History, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface AuditEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  actor_system: string | null;
  occurred_at: string;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  reason: string | null;
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "25" });
    if (actionFilter) params.set("action", actionFilter);
    if (entityFilter) params.set("entity_type", entityFilter);

    try {
      const res = await fetch(`/api/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error("Failed to fetch audit events", e);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const totalPages = Math.ceil(total / 25);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit History</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Track all changes across your workspace</p>
      </div>

      <div className="flex gap-3">
        <Input
          placeholder="Filter by action..."
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <Input
          placeholder="Filter by entity type..."
          value={entityFilter}
          onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-[var(--muted)]/50">
              <th className="text-left px-4 py-3 font-medium">Time</th>
              <th className="text-left px-4 py-3 font-medium">Actor</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Entity</th>
              <th className="text-left px-4 py-3 font-medium">Changes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  ))}
                </tr>
              ))
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-[var(--muted-foreground)]">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No audit events found</p>
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} className="border-b hover:bg-[var(--muted)]/30">
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {new Date(event.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {event.actor_name || event.actor_system || "System"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">{event.action}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="font-medium">{event.entity_type}</span>
                    <span className="text-[var(--muted-foreground)] ml-1">
                      {event.entity_id?.slice(0, 8)}...
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-xs">
                    {event.reason && (
                      <span className="text-[var(--muted-foreground)]">{event.reason}</span>
                    )}
                    {event.before_values && event.after_values && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[var(--primary)] hover:underline">View changes</summary>
                        <pre className="mt-1 p-2 bg-[var(--muted)] rounded text-xs overflow-x-auto">
                          {JSON.stringify({ before: event.before_values, after: event.after_values }, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--muted-foreground)]">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
