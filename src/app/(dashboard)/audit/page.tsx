"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  History, Bell, Layers, Package, Upload, SlidersHorizontal, Building2, UserRound, Activity, ChevronLeft, ChevronRight, Quote,
} from "lucide-react";
import { UserAvatar } from "@/components/ui/brand";
import { describeEvent, type Described, type Refs } from "@/lib/audit-describe";
import { Sentence, ChangeList, lowerFirst } from "@/components/audit/audit-entry";

interface AuditEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  actor_avatar: string | null;
  actor_system: string | null;
  occurred_at: string;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  reason: string | null;
}

const PAGE_SIZE = 30;

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "", label: "Everything" },
  { key: "alerts", label: "Alerts" },
  { key: "groups", label: "Groups" },
  { key: "products", label: "Products" },
  { key: "imports", label: "Imports" },
  { key: "scoring", label: "Scoring" },
  { key: "workspace", label: "Workspace" },
  { key: "account", label: "Accounts" },
];

const CATEGORY_STYLE: Record<Described["category"], { icon: React.ElementType; label: string; cls: string }> = {
  alerts: { icon: Bell, label: "Alert", cls: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30" },
  groups: { icon: Layers, label: "Group", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30" },
  products: { icon: Package, label: "Product", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" },
  imports: { icon: Upload, label: "Import", cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30" },
  scoring: { icon: SlidersHorizontal, label: "Scoring", cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30" },
  workspace: { icon: Building2, label: "Workspace", cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" },
  account: { icon: UserRound, label: "Account", cls: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600" },
  other: { icon: Activity, label: "Other", cls: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600" },
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (x: Date, y: Date) => x.toDateString() === y.toDateString();
  const full = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (same(d, today)) return `Today · ${full}`;
  if (same(d, yesterday)) return `Yesterday · ${full}`;
  return full;
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [refs, setRefs] = useState<Refs>({});
  const [actors, setActors] = useState<Array<{ id: string; name: string }>>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState("");
  const [actor, setActor] = useState("");
  const [hideLogins, setHideLogins] = useState(true);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (category) params.set("category", category);
    if (actor) params.set("actor_id", actor);
    if (hideLogins) params.set("hide_logins", "true");
    return params.toString();
  }, [page, category, actor, hideLogins]);
  // Loading until the events shown are for the current filters
  const loading = loadedKey !== query;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/audit?${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setEvents(data.events || []);
          setRefs(data.refs || {});
          setActors(data.actors || []);
          setTotal(data.total || 0);
        }
        setLoadedKey(query);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Group by calendar day, newest first (events already arrive newest first)
  const days = useMemo(() => {
    const out: Array<{ label: string; items: Array<{ e: AuditEvent; d: Described }> }> = [];
    for (const e of events) {
      const label = dayLabel(e.occurred_at);
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push({ e, d: describeEvent(e, refs) });
    }
    return out;
  }, [events, refs]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pick = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Audit History</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Who changed what, and when.</p>
      </div>

      <div className="panel overflow-hidden">
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 lg:flex-row lg:items-center dark:border-slate-800">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Area">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                role="tab"
                aria-selected={category === c.key}
                onClick={() => pick(() => setCategory(c.key))}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  category === c.key
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="sr-only">Who</span>
              <select
                value={actor}
                onChange={(e) => pick(() => setActor(e.target.value))}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="">Everyone</option>
                {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={hideLogins} onChange={(e) => pick(() => setHideLogins(e.target.checked))} className="h-4 w-4 accent-blue-600" />
              Hide sign-ins
            </label>
          </div>
        </div>

        {/* Timeline */}
        {loading && events.length === 0 ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <History className="h-8 w-8 text-slate-300" />
            <p className="mt-2 font-medium text-slate-700 dark:text-slate-300">Nothing here yet</p>
            <p className="text-sm text-slate-500">Changes made in this workspace will appear here.</p>
          </div>
        ) : (
          <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
            {days.map((day) => (
              <section key={day.label}>
                <h2 className="sticky top-14 z-10 border-y border-slate-100 bg-slate-50/95 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur lg:top-0 dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-400">
                  {day.label}
                </h2>
                <ol className="divide-y divide-slate-100 dark:divide-slate-800">
                  {day.items.map(({ e, d }) => {
                    const style = CATEGORY_STYLE[d.category];
                    const who = e.actor_name || e.actor_system || "System";
                    return (
                      <li key={e.id} className="flex gap-3 px-4 py-3.5">
                        <UserAvatar name={who} src={e.actor_avatar} className="mt-0.5 h-8 w-8 shrink-0 text-[10px]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                            <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                              <span className="font-semibold text-slate-900 dark:text-white">{who}</span>{" "}
                              <Sentence parts={lowerFirst(d.summary)} />
                            </p>
                            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${style.cls}`}>
                              <style.icon className="h-3 w-3" /> {style.label}
                            </span>
                            <time
                              dateTime={e.occurred_at}
                              title={new Date(e.occurred_at).toLocaleString()}
                              className="shrink-0 text-xs tabular-nums text-slate-500"
                            >
                              {new Date(e.occurred_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                            </time>
                          </div>
                          {d.note && (
                            <p className="mt-1.5 flex items-start gap-1.5 text-sm italic text-slate-500 dark:text-slate-400">
                              <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {d.note}
                            </p>
                          )}
                          <ChangeList changes={d.changes} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
            <p className="text-slate-500">
              {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1}
                aria-label="Previous page"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                aria-label="Next page"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
