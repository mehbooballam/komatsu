"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Shield, Calendar, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityBadge, type Priority } from "@/components/dashboard/priority-badge";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AlertDrawer } from "@/components/alerts/alert-drawer";

interface AssignedAlert {
  id: string;
  external_alert_id: string;
  title: string;
  stage: string;
  jurisdiction_raw: string;
  next_compliance_deadline: string | null;
  days_remaining: number | null;
  effective_total: number | null;
  effective_priority: string;
  primary_group_title: string | null;
}

export default function MyRisksPage() {
  const [alerts, setAlerts] = useState<AssignedAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);

  const fetchMyAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/alerts?assigned_to_me=true&limit=100&sort=priority&dir=desc");
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      }
    } catch (e) {
      console.error("Failed to fetch assigned alerts", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMyAlerts(); }, [fetchMyAlerts]);

  const grouped = {
    critical: alerts.filter((a) => a.effective_priority === "critical"),
    high: alerts.filter((a) => a.effective_priority === "high"),
    moderate: alerts.filter((a) => a.effective_priority === "moderate"),
    low: alerts.filter((a) => a.effective_priority === "low"),
    unscored: alerts.filter((a) => !a.effective_priority || a.effective_priority === "unscored"),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Risks</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Alerts assigned to you</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="border rounded-lg p-12 text-center">
          <Shield className="w-10 h-10 mx-auto mb-3 text-[var(--muted-foreground)] opacity-50" />
          <p className="font-medium">No alerts assigned to you</p>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Alerts will appear here when a manager assigns them to you
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([priority, items]) =>
          items.length === 0 ? null : (
            <div key={priority}>
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">
                <PriorityBadge priority={priority as Priority} />
                <span>{items.length} alert{items.length !== 1 ? "s" : ""}</span>
              </h2>
              <div className="space-y-2">
                {items.map((alert) => (
                  <div
                    key={alert.id}
                    className="border rounded-lg p-4 hover:bg-[var(--muted)]/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedAlert(alert.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{alert.title}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted-foreground)]">
                          <span>{alert.external_alert_id}</span>
                          {alert.jurisdiction_raw && <span>{alert.jurisdiction_raw}</span>}
                          {alert.stage && <Badge variant="outline" className="text-xs">{alert.stage}</Badge>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {alert.effective_total !== null && (
                          <div className="font-mono text-sm">{alert.effective_total}</div>
                        )}
                        {alert.next_compliance_deadline && (
                          <div className="flex items-center gap-1 text-xs mt-1">
                            <Calendar className="w-3 h-3" />
                            <span className={
                              alert.days_remaining !== null && alert.days_remaining <= 30
                                ? "text-[var(--priority-critical)] font-medium"
                                : alert.days_remaining !== null && alert.days_remaining <= 180
                                ? "text-[var(--priority-moderate)]"
                                : "text-[var(--muted-foreground)]"
                            }>
                              {new Date(`${String(alert.next_compliance_deadline).slice(0, 10)}T00:00:00`).toLocaleDateString()}
                              {alert.days_remaining !== null && (
                                <> ({alert.days_remaining < 0 ? `${Math.abs(alert.days_remaining)}d overdue` : `${alert.days_remaining}d`})</>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )
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
