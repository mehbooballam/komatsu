"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { WorldMap } from "@/components/dashboard/world-map";
import { ParetoChart } from "@/components/dashboard/pareto-chart";
import { AlertsTable, type AlertRow } from "@/components/alerts/alerts-table";
import { AlertDrawer } from "@/components/alerts/alert-drawer";
import { useSessionInfo } from "@/components/layout/session-context";
import {
  AlertTriangle, Clock, FileWarning, Layers, Loader2, Upload, ArrowRight,
  Globe2, TrendingUp, RefreshCw, CalendarDays, Flame, ListChecks, CheckCircle2,
  ChevronRight, UserPlus, Tag, Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Band = "critical" | "high" | "moderate" | "low" | "unscored";

interface SummaryData {
  total_alerts: number;
  critical_count: number;
  by_band?: Record<Band, number>;
  /** Band from the numeric score alone, before escalation rules. */
  by_score_band?: Record<Band, number>;
  escalated_count?: number;
  due_soon_count: number;
  needs_review_count: number;
  assigned_count?: number;
  last_import_date: string | null;
  as_of_date: string;
}

interface MapCountry {
  code: string;
  iso_code: string;
  display_name: string;
  alert_count: number;
  highest_priority: string;
  by_band: Record<Band, number>;
}

interface MapData {
  countries: MapCountry[];
  unmapped_count: number;
}

interface ParetoData {
  data: Array<{
    alert_id: string;
    external_alert_id: string;
    title: string;
    score: number;
    priority: string;
    cumulative_pct: number;
  }>;
  total_sum: number;
  total_scored_count: number;
  displayed_count: number;
}

const BAND_ORDER: Band[] = ["critical", "high", "moderate", "low", "unscored"];
const BAND_COLORS: Record<Band, string> = {
  critical: "#7c3aed",
  high: "#dc4a0c",
  moderate: "#f59e0b",
  low: "#14b8a6",
  unscored: "#94a3b8",
};
const BAND_LABELS: Record<Band, string> = {
  critical: "Critical",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  unscored: "Unscored",
};

const ACTIONS = [
  {
    key: "unassigned_hot",
    label: "Critical & high without an owner",
    hint: "Assign someone to own these",
    query: "priority=critical,high&owner_id=unassigned",
    href: "/alerts?priority=critical,high&owner_id=unassigned",
    icon: UserPlus,
    tone: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
  },
  {
    key: "overdue",
    label: "Overdue deadlines",
    hint: "Past their compliance date",
    query: "deadline_within=overdue",
    href: "/alerts?deadline_within=overdue",
    icon: AlertTriangle,
    tone: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
  },
  {
    key: "due30",
    label: "Due within 30 days",
    hint: "Plan the work now",
    query: "deadline_within=30",
    href: "/alerts?deadline_within=30",
    icon: Clock,
    tone: "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300",
  },
  {
    key: "ungrouped",
    label: "Not in a regulation group",
    hint: "Group related alerts together",
    query: "group_id=none",
    href: "/alerts?group_id=none",
    icon: Tag,
    tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300",
  },
  {
    key: "review",
    label: "Needs review",
    hint: "Missing or incomplete scores",
    query: "needs_review=true",
    href: "/alerts?needs_review=true",
    icon: FileWarning,
    tone: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
  },
];

const TABLE_TABS = [
  { key: "priority", label: "Top priority", query: "sort=priority", href: "/alerts" },
  { key: "due", label: "Due soon", query: "deadline_within=90&sort=deadline&dir=asc", href: "/alerts?deadline_within=90" },
  { key: "unassigned", label: "Unassigned", query: "owner_id=unassigned&sort=priority", href: "/alerts?owner_id=unassigned" },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const date = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* ---------- Building blocks ---------- */

/**
 * Explains how the risk concentration (Pareto) chart is calculated,
 * with a worked example from the live data.
 */
function ConcentrationInfo({ data }: { data: ParetoData | null }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How risk concentration is calculated"
          title="How it’s calculated"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400"
        >
          <Info className="h-[18px] w-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(560px,calc(100vw-2rem))] p-0">
        {data ? <ConcentrationFormula data={data} /> : <p className="p-4 text-sm text-slate-500">Loading…</p>}
      </PopoverContent>
    </Popover>
  );
}

function ConcentrationFormula({ data }: { data: ParetoData }) {
  const rows = data.data;
  if (!rows.length || data.total_sum <= 0) {
    return <p className="p-4 text-sm text-slate-500">No scored alerts yet — the chart fills in once alerts have a risk score.</p>;
  }
  const total = data.total_sum;
  const fmt = (n: number) => n.toLocaleString();
  const pct = (n: number) => `${(Math.round((n / total) * 1000) / 10).toLocaleString()}%`;

  // Worked example: the top 3 (or fewer) alerts
  const n = Math.min(3, rows.length);
  const top = rows.slice(0, n);
  const topSum = top.reduce((s, r) => s + (r.score || 0), 0);

  // How many alerts carry 80% of the total risk (only answerable if the chart reaches 80%)
  const idx80 = rows.findIndex((r) => r.cumulative_pct >= 80);
  const share = idx80 >= 0 ? Math.round(((idx80 + 1) / data.total_scored_count) * 100) : null;

  return (
    <div className="max-h-[70vh] overflow-y-auto p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
        <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" /> How risk concentration is calculated
      </p>

      <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
        <li>
          Each <strong className="text-slate-800 dark:text-slate-100">bar</strong> is one alert’s final risk score:{" "}
          <span className="whitespace-nowrap font-mono text-[12px] text-slate-800 dark:text-slate-200">Market access × Cost × Urgency</span>{" "}
          (1–729, including any manual adjustment). Alerts are sorted from highest to lowest.
        </li>
        <li>
          The <strong className="text-slate-800 dark:text-slate-100">line</strong> is the running share of all risk:
        </li>
      </ol>
      <div className="mt-2 overflow-x-auto rounded-lg bg-white px-3 py-2.5 text-center font-mono text-[13px] text-slate-800 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-100 dark:ring-slate-700">
        Cumulative share at rank <i>n</i> = (sum of scores of alerts 1…<i>n</i>) ÷ (sum of all scores) × 100%
      </div>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        Sum of all scores = <strong className="text-slate-800 dark:text-slate-100">{fmt(total)}</strong> across{" "}
        {fmt(data.total_scored_count)} scored alerts.
        {idx80 >= 0 && share !== null && (
          <>
            {" "}The top <strong className="text-slate-800 dark:text-slate-100">{fmt(idx80 + 1)}</strong> alert{idx80 === 0 ? "" : "s"} ({share}% of alerts) carry{" "}
            <strong className="text-slate-800 dark:text-slate-100">80%</strong> of the total risk — focus there first.
          </>
        )}
      </p>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Worked example</p>
      <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-1 pr-3 font-semibold">Rank</th>
                <th className="py-1 pr-3 font-semibold">Alert</th>
                <th className="py-1 pr-3 text-right font-semibold">Score</th>
                <th className="py-1 pr-3 text-right font-semibold">Running total</th>
                <th className="py-1 text-right font-semibold">Cumulative share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {top.map((r, i) => {
                const running = top.slice(0, i + 1).reduce((s, x) => s + (x.score || 0), 0);
                return (
                  <tr key={r.alert_id} className="text-slate-700 dark:text-slate-300">
                    <td className="py-1.5 pr-3 tabular-nums">{i + 1}</td>
                    <td className="max-w-[170px] truncate py-1.5 pr-3" title={r.title}>{r.title}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.score)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(running)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right font-mono tabular-nums">
                      {fmt(running)} ÷ {fmt(total)} = <strong className="text-slate-900 dark:text-white">{pct(running)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            So the top {n} alert{n === 1 ? "" : "s"} account for {pct(topSum)} of all risk in this workspace.
          </p>
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-5 ${className}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              <Icon className="h-[18px] w-[18px]" />
            </span>
          )}
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--muted-foreground)]">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  onClick,
  loading,
  children,
}: {
  title: string;
  value: number;
  hint?: string;
  icon: React.ElementType;
  tone: "blue" | "violet" | "orange" | "amber";
  onClick?: () => void;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  const tones = {
    blue: "from-blue-500 to-indigo-600 shadow-blue-500/30",
    violet: "from-violet-500 to-purple-600 shadow-violet-500/30",
    orange: "from-orange-500 to-red-500 shadow-orange-500/30",
    amber: "from-amber-400 to-orange-500 shadow-amber-500/30",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="panel group relative w-full overflow-hidden p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-[var(--muted-foreground)]">{title}</p>
          <p className="mt-1.5 text-3xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
            {loading ? <Loader2 className="h-7 w-7 animate-spin text-slate-300" /> : value.toLocaleString()}
          </p>
          {hint && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{hint}</p>}
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {children && <div className="mt-4">{children}</div>}
      <ArrowRight className="absolute bottom-4 right-4 h-4 w-4 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function BandBar({ byBand, total }: { byBand: Record<Band, number>; total: number }) {
  if (!total) return <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800" />;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      {BAND_ORDER.filter((b) => byBand[b] > 0).map((b) => (
        <div
          key={b}
          style={{ width: `${(byBand[b] / total) * 100}%`, backgroundColor: BAND_COLORS[b] }}
          title={`${BAND_LABELS[b]}: ${byBand[b]}`}
        />
      ))}
    </div>
  );
}

function PriorityDonut({ byBand, total, onSelect }: { byBand: Record<Band, number>; total: number; onSelect: (b: Band) => void }) {
  const data = BAND_ORDER.map((b) => ({ band: b, name: BAND_LABELS[b], value: byBand[b] })).filter((d) => d.value > 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.length ? data : [{ band: "unscored", name: "None", value: 1 }]}
              dataKey="value"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              onClick={(d) => {
                const band = (d as unknown as { payload?: { band?: Band } })?.payload?.band;
                if (band && data.length) onSelect(band);
              }}
              cursor={data.length ? "pointer" : undefined}
            >
              {(data.length ? data : [{ band: "unscored" as Band }]).map((d) => (
                <Cell key={d.band} fill={data.length ? BAND_COLORS[d.band] : "#e2e8f0"} />
              ))}
            </Pie>
            {data.length > 0 && (
              <Tooltip
                formatter={(v, n) => [`${v ?? 0} alerts`, String(n)]}
                contentStyle={{ borderRadius: 10, border: "1px solid #e3e8f0", fontSize: 12 }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{total}</span>
          <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">alerts</span>
        </div>
      </div>
      <ul className="w-full space-y-1.5">
        {BAND_ORDER.filter((b) => b !== "unscored" || byBand.unscored > 0).map((b) => {
          const pct = total ? Math.round((byBand[b] / total) * 100) : 0;
          return (
            <li key={b}>
              <button
                type="button"
                onClick={() => onSelect(b)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BAND_COLORS[b] }} />
                <span className="flex-1 text-left text-slate-700 dark:text-slate-300">{BAND_LABELS[b]}</span>
                <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{byBand[b]}</span>
                <span className="w-10 text-right text-xs tabular-nums text-[var(--muted-foreground)]">{pct}%</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TopCountries({ countries, onSelect }: { countries: MapCountry[]; onSelect: (code: string) => void }) {
  const top = [...countries].sort((a, b) => b.alert_count - a.alert_count).slice(0, 7);
  const max = top[0]?.alert_count || 1;
  if (!top.length) {
    return <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">No alerts are mapped to countries yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {top.map((c) => (
        <li key={c.code}>
          <button type="button" onClick={() => onSelect(c.iso_code || c.code)} className="group w-full text-left">
            <div className="mb-1 flex items-center gap-2 text-sm">
              <span className="inline-flex h-5 w-7 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {c.iso_code || c.code}
              </span>
              <span className="flex-1 truncate text-slate-700 group-hover:text-blue-600 dark:text-slate-300">{c.display_name}</span>
              <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{c.alert_count}</span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" style={{ width: `${Math.max(8, (c.alert_count / max) * 100)}%` }}>
              {BAND_ORDER.filter((b) => c.by_band[b] > 0).map((b) => (
                <div key={b} style={{ width: `${(c.by_band[b] / c.alert_count) * 100}%`, backgroundColor: BAND_COLORS[b] }} />
              ))}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="panel relative overflow-hidden px-6 py-16 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.08),transparent_60%)]" />
      <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-xl shadow-blue-500/30">
        <Upload className="h-7 w-7" />
      </div>
      <h2 className="relative mt-5 text-xl font-semibold text-slate-900 dark:text-white">No alerts yet</h2>
      <p className="relative mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
        Import your Daptic alert file (.xlsx or .csv) to see your risk heat map, priority breakdown and top risks here.
      </p>
      <Link
        href="/imports"
        className="relative mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 hover:bg-blue-700"
      >
        <Upload className="h-4 w-4" /> Import alerts
      </Link>
    </div>
  );
}

/* ---------- Page ---------- */

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [paretoData, setParetoData] = useState<ParetoData | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; error: string | null } | null>(null);
  const [attention, setAttention] = useState<Record<string, number> | null>(null);
  const [tableTab, setTableTab] = useState<string>("priority");
  const [mixView, setMixView] = useState<"final" | "score">("final");
  const [tableRows, setTableRows] = useState<AlertRow[] | null>(null);
  const [openAlert, setOpenAlert] = useState<string | null>(null);
  const session = useSessionInfo();
  const canEdit = session?.membership.role !== "risk_owner";
  const canDelete = session?.membership.role === "company_admin" || session?.membership.role === "manager";

  // Loading/error belong to a specific reloadKey, so starting a reload needs no setState
  const loading = loaded?.key !== reloadKey;
  const error = loaded?.key === reloadKey ? loaded.error : null;
  const fetchData = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    const key = reloadKey;
    (async () => {
      let failure: string | null = null;
      try {
        const [summaryRes, mapRes, paretoRes, meRes] = await Promise.all([
          fetch("/api/dashboard/summary"),
          fetch("/api/dashboard/map"),
          fetch("/api/dashboard/pareto"),
          fetch("/api/users/me"),
        ]);

        if (summaryRes.status === 401) {
          router.push("/login");
          return;
        }
        if (!summaryRes.ok || !mapRes.ok || !paretoRes.ok) {
          throw new Error("Failed to load dashboard data");
        }

        const [summaryJson, mapJson, paretoJson] = await Promise.all([summaryRes.json(), mapRes.json(), paretoRes.json()]);
        if (cancelled) return;
        setSummary(summaryJson);
        setMapData(mapJson);
        setParetoData(paretoJson);
        if (meRes.ok) {
          const me = await meRes.json();
          if (!cancelled) setUserName((me?.user?.display_name || "").split(" ")[0]);
        }
      } catch (err) {
        failure = err instanceof Error ? err.message : "An error occurred";
      }
      if (!cancelled) setLoaded({ key, error: failure });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, reloadKey]);

  // Action counts (each is just the total of a filtered alert query)
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ACTIONS.map((a) =>
        fetch(`/api/alerts?per_page=1&${a.query}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => [a.key, d?.pagination?.total ?? 0] as const)
      )
    ).then((pairs) => !cancelled && setAttention(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Dashboard alerts table
  useEffect(() => {
    let cancelled = false;
    const tab = TABLE_TABS.find((t) => t.key === tableTab)!;
    fetch(`/api/alerts?per_page=10&${tab.query}`)
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d) => !cancelled && setTableRows(d.alerts || []));
    return () => {
      cancelled = true;
    };
  }, [tableTab, reloadKey]);

  const goCountry = (code: string) =>
    router.push(code === "unmapped" ? "/alerts?geography=unmapped" : `/alerts?geography=${code}`);
  const goPriority = (band: Band) => router.push(`/alerts?priority=${band}`);

  if (error) {
    return (
      <div className="panel mx-auto mt-16 max-w-md p-10 text-center">
        <FileWarning className="mx-auto mb-3 h-12 w-12 text-red-400" />
        <p className="mb-1 text-lg font-semibold">Couldn&apos;t load the dashboard</p>
        <p className="mb-5 text-sm text-[var(--muted-foreground)]">{error}</p>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  const byBand: Record<Band, number> = summary?.by_band ?? { critical: summary?.critical_count ?? 0, high: 0, moderate: 0, low: 0, unscored: 0 };
  const total = summary?.total_alerts ?? 0;
  const highPlus = byBand.critical + byBand.high;
  const isEmpty = !loading && total === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0b1f45] via-[#12357a] to-[#1d4ed8] px-6 py-6 text-white shadow-lg sm:px-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="pointer-events-none absolute right-24 -bottom-24 h-56 w-56 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-sky-200">{greeting()}{userName ? `, ${userName}` : ""}</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight sm:text-3xl">Regulatory risk overview</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-100/90">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" /> Scores as of {formatDate(summary?.as_of_date)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Upload className="h-3.5 w-3.5" /> Last import {formatDate(summary?.last_import_date)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/imports"
              className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur hover:bg-white/20"
            >
              <Upload className="h-4 w-4" /> Import alerts
            </Link>
            <Link
              href="/alerts"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow hover:bg-blue-50"
            >
              View all alerts <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Total alerts" value={total} icon={Layers} tone="blue" loading={loading} onClick={() => router.push("/alerts")}>
              <BandBar byBand={byBand} total={total} />
            </KpiCard>
            <KpiCard
              title="Critical"
              value={byBand.critical}
              hint={total ? `+${byBand.high} high · ${Math.round((highPlus / total) * 100)}% of alerts high or critical` : undefined}
              icon={Flame}
              tone="orange"
              loading={loading}
              onClick={() => router.push("/alerts?priority=critical")}
            />
            {/* Deadlines and review counts live in "Actions required" below, so these show other figures */}
            <KpiCard
              title="Assigned"
              value={summary?.assigned_count ?? 0}
              hint={
                total
                  ? `${Math.round(((summary?.assigned_count ?? 0) / total) * 100)}% of alerts have an owner · ${total - (summary?.assigned_count ?? 0)} unassigned`
                  : undefined
              }
              icon={UserPlus}
              tone="violet"
              loading={loading}
              onClick={() => router.push("/alerts?owner_id=unassigned")}
            />
            <KpiCard
              title="Countries affected"
              value={mapData?.countries.length ?? 0}
              hint={mapData?.unmapped_count ? `${mapData.unmapped_count} alerts without a mapped country` : "Every alert is mapped to a country"}
              icon={Globe2}
              tone="amber"
              loading={loading}
              onClick={() => document.getElementById("risk-map")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            />
          </div>

          {/* Actions required */}
          <section className="panel p-5">
            <header className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                <ListChecks className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Actions required</h2>
                <p className="text-xs text-[var(--muted-foreground)]">What needs attention now — click to see the alerts</p>
              </div>
            </header>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {ACTIONS.map((a) => {
                const n = attention?.[a.key];
                const done = n === 0;
                return (
                  <li key={a.key}>
                    <Link
                      href={a.href}
                      className={`group flex h-full flex-col gap-3 rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${
                        done
                          ? "border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30"
                          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${done ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" : a.tone}`}>
                          {done ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <a.icon className="h-[18px] w-[18px]" />}
                        </span>
                        <span className={`text-2xl font-bold tabular-nums ${done ? "text-slate-300 dark:text-slate-600" : "text-slate-900 dark:text-white"}`}>
                          {n === undefined ? <Loader2 className="h-5 w-5 animate-spin text-slate-300" /> : n}
                        </span>
                      </div>
                      <div>
                        <span className={`block text-sm font-medium leading-snug ${done ? "text-slate-500" : "text-slate-900 dark:text-white"}`}>{a.label}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                          {done ? "All clear" : a.hint}
                          <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Map + priority mix */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <section id="risk-map" className="panel scroll-mt-20 p-5 xl:col-span-2">
              {loading || !mapData ? (
                <div className="flex h-80 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div>
              ) : (
                <WorldMap countries={mapData.countries} unmappedCount={mapData.unmapped_count} onCountryClick={goCountry} />
              )}
            </section>
            <Panel
              title="Priority mix"
              subtitle={
                mixView === "final"
                  ? `Final priority, after escalation${summary?.escalated_count ? ` · ${summary.escalated_count} escalated` : ""}`
                  : "Band from the score alone (before escalation)"
              }
              icon={TrendingUp}
              action={
                <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium dark:bg-slate-800">
                  {(["final", "score"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setMixView(v)}
                      className={`whitespace-nowrap rounded-md px-2.5 py-1 transition-colors ${
                        mixView === v ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {v === "final" ? "Final" : "By score"}
                    </button>
                  ))}
                </div>
              }
            >
              {loading ? (
                <div className="flex h-60 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div>
              ) : (
                <PriorityDonut
                  byBand={mixView === "final" ? byBand : summary?.by_score_band ?? byBand}
                  total={total}
                  onSelect={mixView === "final" ? goPriority : () => {}}
                />
              )}
            </Panel>
          </div>

          {/* Pareto + countries */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Panel
              className="xl:col-span-2"
              title="Risk concentration"
              subtitle={
                paretoData
                  ? `${paretoData.displayed_count < paretoData.total_scored_count ? `Top ${paretoData.displayed_count} of ${paretoData.total_scored_count}` : paretoData.total_scored_count} scored alerts, highest first · line shows cumulative share of total risk`
                  : undefined
              }
              icon={Layers}
              action={<ConcentrationInfo data={paretoData} />}
            >
              {loading || !paretoData ? (
                <div className="flex h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div>
              ) : (
                <>
                  <ParetoChart
                    data={paretoData.data}
                    totalSum={paretoData.total_sum}
                    totalScoredCount={paretoData.total_scored_count}
                    displayedCount={paretoData.displayed_count}
                    onBarClick={(id) => router.push(`/alerts/${id}`)}
                  />
                </>
              )}
            </Panel>
            <Panel
              title="Top countries"
              subtitle="By number of alerts"
              icon={Globe2}
              action={
                mapData && mapData.unmapped_count > 0 ? (
                  <button onClick={() => goCountry("unmapped")} className="text-xs font-medium text-blue-600 hover:underline">
                    {mapData.unmapped_count} unmapped
                  </button>
                ) : undefined
              }
            >
              {loading || !mapData ? (
                <div className="flex h-60 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div>
              ) : (
                <TopCountries countries={mapData.countries} onSelect={goCountry} />
              )}
            </Panel>
          </div>

          {/* Alerts table — full width at the bottom */}
            <section className="panel overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                    <Flame className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Alerts</h2>
                    <p className="text-xs text-[var(--muted-foreground)]">Click a row to review, assign or adjust</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  {TABLE_TABS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTableTab(t.key)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        tableTab === t.key ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-300"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </header>
              <div className="mt-3 px-2">
                <AlertsTable
                  alerts={tableRows ?? []}
                  loading={tableRows === null}
                  canDelete={canDelete}
                  canEdit={canEdit}
                  onOpen={setOpenAlert}
                  onChanged={() => setReloadKey((k) => k + 1)}
                  emptyMessage="Nothing here — nice work."
                />
              </div>
              <div className="flex justify-end border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                <Link href={TABLE_TABS.find((t) => t.key === tableTab)?.href || "/alerts"} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
                  View all <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </section>
        </>
      )}

      {openAlert && (
        <AlertDrawer
          alertId={openAlert}
          onClose={() => setOpenAlert(null)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
