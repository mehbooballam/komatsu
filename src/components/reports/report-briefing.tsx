"use client";

import React, { createContext, useContext } from "react";
import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertOctagon, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, CircleDot, Clock3, Flag,
  Gavel, ListChecks, ShieldAlert, Sparkles, UserX, Layers, Minus, Pencil, RotateCcw, UserRound,
} from "lucide-react";
import {
  LEVEL_LABELS, RAG_LABELS, STATUS_LABELS, TREND_LABELS, periodLabel,
  type HistoryPoint, type ReportContent, type ReportSnapshot, type RiskLevel, type ScoreStatus, type SectionKey, type Trend,
} from "@/lib/reports";

// ── per-section editing ─────────────────────────────────────────────────────

export interface SectionEditing {
  /** Section currently open for editing */
  editing: SectionKey | null;
  edited: SectionKey[];
  onEdit: (key: SectionKey) => void;
  onReset: (key: SectionKey) => void;
  /** The inline editor (fields + save / cancel) for the open section */
  renderEditor: (key: SectionKey) => React.ReactNode;
}

const EditCtx = createContext<SectionEditing | null>(null);

const SECTION_LABEL: Record<SectionKey, string> = {
  cover: "rating and headline",
  summary: "summary",
  priorities: "priorities",
  decisions: "decisions",
  risks: "material risks",
  scorecard: "scorecard",
  next_30_days: "next 30 days",
};

/** Wraps a section: edit pencil, "Edited" tag and reset when editable; the editor when open. */
function Editable({ k, children, className = "" }: { k: SectionKey; children: React.ReactNode; className?: string }) {
  const ctx = useContext(EditCtx);
  if (!ctx) return <div className={className}>{children}</div>;
  if (ctx.editing === k) {
    return (
      <section className={`panel p-4 ring-2 ring-blue-500/40 sm:p-5 ${className}`}>
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Edit {SECTION_LABEL[k]}</h3>
        {ctx.renderEditor(k)}
      </section>
    );
  }
  const edited = ctx.edited.includes(k);
  return (
    <div className={`group/edit relative ${className}`}>
      {children}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 print:hidden">
        {edited && (
          <>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30" title="Edited by hand — kept when the report refreshes">
              Edited
            </span>
            <button
              type="button"
              onClick={() => ctx.onReset(k)}
              title="Reset to automatic"
              aria-label={`Reset ${SECTION_LABEL[k]} to automatic`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-slate-500 ring-1 ring-slate-200 hover:text-slate-900 dark:bg-slate-900/80 dark:ring-slate-700 dark:hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => ctx.onEdit(k)}
          title={`Edit ${SECTION_LABEL[k]}`}
          aria-label={`Edit ${SECTION_LABEL[k]}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-slate-500 opacity-70 ring-1 ring-slate-200 hover:text-blue-700 hover:opacity-100 group-hover/edit:opacity-100 dark:bg-slate-900/80 dark:ring-slate-700 dark:hover:text-blue-300"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * The report as a visual leadership briefing: headline figures with month-on-month
 * change, charts from the alert register, a priority map, scorecard progress and
 * the written sections as cards. Used for the on-screen preview and for printing.
 */

// Same risk-band colours as the dashboard (validated for colour-blind separation;
// amber and teal are low-contrast on white, so bars always carry value labels).
const BAND = {
  critical: "#7c3aed",
  high: "#dc4a0c",
  moderate: "#f59e0b",
  low: "#14b8a6",
  unscored: "#94a3b8",
} as const;

const LEVEL_COLOR: Record<Exclude<RiskLevel, "">, string> = {
  high: BAND.high,
  med_high: "#ea7a0c",
  medium: BAND.moderate,
  low: BAND.low,
};

const RAG = {
  green: { bg: "bg-emerald-600", text: "text-white", soft: "bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30" },
  amber: { bg: "bg-amber-400", text: "text-slate-900", soft: "bg-amber-50 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30" },
  red: { bg: "bg-red-600", text: "text-white", soft: "bg-red-50 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/30" },
} as const;

// Scorecard status: reserved status colours, always shown with an icon and a label
const STATUS: Record<Exclude<ScoreStatus, "">, { color: string; icon: React.ElementType; pill: string }> = {
  open: { color: "#dc2626", icon: AlertOctagon, pill: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30" },
  at_risk: { color: "#d97706", icon: Flag, pill: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" },
  in_progress: { color: "#2563eb", icon: Clock3, pill: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30" },
  complete: { color: "#16a34a", icon: CheckCircle2, pill: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" },
};
const STATUS_ORDER: Array<Exclude<ScoreStatus, "">> = ["open", "at_risk", "in_progress", "complete"];

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const has = (s: string | undefined | null) => !!s && s.trim().length > 0;
const monthShort = (period: string) =>
  new Date(`${period.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

// ── building blocks ─────────────────────────────────────────────────────────

function Panel({ title, icon: Icon, hint, children, className = "" }: {
  title: string; icon?: React.ElementType; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`panel break-inside-avoid p-4 sm:p-5 ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
            {title}
          </h3>
          {hint && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; label?: string;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: { fill?: string } }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {label && <div className="mb-1 font-semibold text-slate-900 dark:text-white">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
            {p.name}
          </span>
          <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[220px] items-center justify-center rounded-lg bg-slate-50 px-6 text-center text-sm text-[var(--muted-foreground)] dark:bg-slate-800/40">{children}</div>;
}

// ── headline figures ───────────────────────────────────────────────────────

function Delta({ now, before, upIsBad = true }: { now: number; before: number | undefined; upIsBad?: boolean }) {
  if (before === undefined) return <span className="text-[11px] text-[var(--muted-foreground)]">First report</span>;
  const d = now - before;
  if (d === 0) {
    return <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--muted-foreground)]"><Minus className="h-3 w-3" /> No change</span>;
  }
  const bad = upIsBad ? d > 0 : d < 0;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${bad ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
      <Icon className="h-3 w-3" /> {d > 0 ? "+" : ""}{d} vs last month
    </span>
  );
}

function Kpis({ snapshot, previous }: { snapshot: ReportSnapshot; previous?: HistoryPoint }) {
  const tiles: Array<{ label: string; value: number; prev?: number; icon: React.ElementType; accent?: string; upIsBad?: boolean; noDelta?: boolean }> = [
    { label: "Active alerts", value: snapshot.total_alerts, prev: previous?.total_alerts, icon: Layers, upIsBad: true },
    { label: "Critical", value: snapshot.critical, prev: previous?.critical, icon: ShieldAlert, accent: BAND.critical },
    { label: "High", value: snapshot.high, prev: previous?.high, icon: AlertOctagon, accent: BAND.high },
    { label: "Overdue deadlines", value: snapshot.overdue, prev: previous?.overdue, icon: CalendarClock, accent: snapshot.overdue ? "#dc2626" : undefined },
    { label: "Due in 30 days", value: snapshot.due_30_days, icon: Clock3, noDelta: true },
    { label: "Without an owner", value: snapshot.unassigned, icon: UserX, noDelta: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="panel break-inside-avoid p-3.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            {t.label}
            <t.icon className="h-3.5 w-3.5" style={t.accent ? { color: t.accent } : undefined} aria-hidden="true" />
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{t.value.toLocaleString()}</div>
          {t.noDelta ? (
            <span className="text-[11px] text-[var(--muted-foreground)]">As of {new Date(`${snapshot.as_of}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
          ) : (
            <Delta now={t.value} before={t.prev} upIsBad={t.upIsBad ?? true} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── charts ──────────────────────────────────────────────────────────────────

function BandChart({ snapshot }: { snapshot: ReportSnapshot }) {
  const data = [
    { name: "Critical", value: snapshot.critical, fill: BAND.critical },
    { name: "High", value: snapshot.high, fill: BAND.high },
    { name: "Moderate", value: snapshot.moderate, fill: BAND.moderate },
    { name: "Low", value: snapshot.low, fill: BAND.low },
    { name: "Unscored", value: snapshot.unscored, fill: BAND.unscored },
  ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 20, right: 8, left: -18, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)" }} />
        <Bar dataKey="value" name="Alerts" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
          <LabelList dataKey="value" position="top" style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TrendChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) {
    return (
      <Empty>
        The month-by-month trend appears once there are two or more monthly reports.
        {history.length === 1 && ` This month: ${history[0].critical} critical, ${history[0].high} high, ${history[0].overdue} overdue.`}
      </Empty>
    );
  }
  const data = history.map((h) => ({ month: monthShort(h.period), Critical: h.critical, High: h.high, Overdue: h.overdue }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="Critical" stroke={BAND.critical} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="High" stroke={BAND.high} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="Overdue" stroke="#64748b" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function DeadlineChart({ deadlines }: { deadlines?: ReportSnapshot["deadlines"] }) {
  if (!deadlines) return <Empty>Refresh the figures to see upcoming deadlines.</Empty>;
  const data = deadlines.map((d) => ({ month: monthShort(d.month), count: d.count }));
  if (!data.some((d) => d.count)) return <Empty>No compliance deadlines in the next six months.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 20, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)" }} />
        <Bar dataKey="count" name="Deadlines" fill="#0f6450" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }} formatter={(v: unknown) => (Number(v) ? String(v) : "")} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GroupChart({ groups }: { groups?: ReportSnapshot["by_group"] }) {
  if (!groups) return <Empty>Refresh the figures to see alerts by regulation group.</Empty>;
  if (!groups.length) return <Empty>No alerts yet.</Empty>;
  const data = groups.map((g) => ({
    name: g.name.length > 28 ? `${g.name.slice(0, 27)}…` : g.name,
    full: g.name,
    Critical: g.critical,
    High: g.high,
    Other: Math.max(0, g.total - g.critical - g.high),
    total: g.total,
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34 + 50)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={150} tick={{ ...AXIS, fill: "var(--foreground)" }} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Critical" stackId="g" fill={BAND.critical} stroke="var(--card)" strokeWidth={1} isAnimationActive={false} />
        <Bar dataKey="High" stackId="g" fill={BAND.high} stroke="var(--card)" strokeWidth={1} isAnimationActive={false} />
        <Bar dataKey="Other" stackId="g" fill="#cbd5e1" stroke="var(--card)" strokeWidth={1} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey="total" position="right" style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Level × trend grid: where each priority area sits and which way it is moving. */
function PriorityMap({ content }: { content: ReportContent }) {
  const rows = content.priorities.filter((p) => has(p.area));
  if (!rows.length) return <Empty>Add priorities to see the map.</Empty>;
  const levels: Array<Exclude<RiskLevel, "">> = ["high", "med_high", "medium", "low"];
  const trends: Array<Exclude<Trend, "">> = ["falling", "stable", "rising"];
  const unplaced = rows.filter((p) => !p.level || !p.trend);
  const TrendIcon = { rising: ArrowUpRight, stable: ArrowRight, falling: ArrowDownRight };
  return (
    <div>
      <div className="grid grid-cols-[64px_repeat(3,minmax(0,1fr))] gap-1 text-xs" lang="en">
        <div />
        {trends.map((t) => {
          const I = TrendIcon[t];
          return (
            <div key={t} className="flex items-center justify-center gap-1 pb-1 font-medium text-[var(--muted-foreground)]">
              <I className="h-3.5 w-3.5" /> {TREND_LABELS[t]}
            </div>
          );
        })}
        {levels.map((l) => (
          <React.Fragment key={l}>
            <div className="flex items-center gap-1.5 pr-1 font-medium text-slate-700 dark:text-slate-200">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: LEVEL_COLOR[l] }} />
              {LEVEL_LABELS[l]}
            </div>
            {trends.map((t) => {
              const items = rows.filter((p) => p.level === l && p.trend === t);
              // Hotter cells: higher level and rising
              const heat = (3 - levels.indexOf(l)) + trends.indexOf(t);
              const tint = ["bg-slate-50", "bg-slate-50", "bg-amber-50/70", "bg-orange-50", "bg-red-50", "bg-red-100/70"][heat];
              return (
                <div key={t} className={`min-h-[52px] rounded-md p-1.5 ${tint} dark:bg-slate-800/50`}>
                  <div className="flex flex-wrap gap-1">
                    {items.map((p, i) => (
                      <span
                        key={i}
                        title={p.out_of_scope ? `${p.area} (out of scope for the team)` : p.area}
                        className={`max-w-full break-words hyphens-auto rounded px-1.5 py-0.5 text-[11px] font-medium leading-snug text-slate-800 ring-1 ring-black/10 dark:text-slate-100 dark:ring-white/15 ${p.out_of_scope ? "bg-yellow-200 dark:bg-yellow-500/30" : "bg-white dark:bg-slate-900"}`}
                      >
                        {p.area}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
        <span className="mr-1 inline-block h-2 w-3 rounded-sm bg-yellow-200 align-middle" /> Out of scope for the team
        {unplaced.length > 0 && ` · Not placed (level or trend missing): ${unplaced.map((p) => p.area).join(", ")}`}
      </p>
    </div>
  );
}

function ScorecardProgress({ content }: { content: ReportContent }) {
  const rows = content.scorecard.filter((s) => has(s.indicator));
  if (!rows.length) return <Empty>Add scorecard indicators to track progress.</Empty>;
  const counts = STATUS_ORDER.map((s) => ({ s, n: rows.filter((r) => r.status === s).length }));
  const unset = rows.filter((r) => !r.status).length;
  const total = rows.length;
  return (
    <div className="space-y-3">
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={counts.map((c) => `${c.n} ${STATUS_LABELS[c.s]}`).join(", ")}>
        {counts.filter((c) => c.n).map((c) => (
          <div key={c.s} style={{ width: `${(c.n / total) * 100}%`, background: STATUS[c.s].color }} />
        ))}
        {unset > 0 && <div style={{ width: `${(unset / total) * 100}%` }} className="bg-slate-200 dark:bg-slate-700" />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        {counts.map((c) => {
          const I = STATUS[c.s].icon;
          return (
            <span key={c.s} className="inline-flex items-center gap-1">
              <I className="h-3.5 w-3.5" style={{ color: STATUS[c.s].color }} /> {STATUS_LABELS[c.s]} <b className="tabular-nums text-slate-900 dark:text-white">{c.n}</b>
            </span>
          );
        })}
      </div>
      <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {rows.map((r, i) => {
          const st = r.status ? STATUS[r.status] : null;
          const I = st?.icon ?? CircleDot;
          return (
            <li key={i} className="flex items-start gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.indicator}</div>
                {(has(r.desired) || has(r.interpretation)) && (
                  <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    {has(r.desired) && <>Target: {r.desired}</>}
                    {has(r.desired) && has(r.interpretation) && " · "}
                    {r.interpretation}
                  </div>
                )}
              </div>
              {r.status && st && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${st.pill}`}>
                  <I className="h-3 w-3" /> {STATUS_LABELS[r.status]}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── the briefing ────────────────────────────────────────────────────────────

export function ReportBriefing({
  title, period, content: c, snapshot, history = [], status, editing = null,
}: {
  title: string;
  period: string;
  content: ReportContent;
  snapshot: ReportSnapshot | null;
  history?: HistoryPoint[];
  status: "draft" | "published";
  /** Pass to make each section editable in place */
  editing?: SectionEditing | null;
}) {
  const rag = RAG[c.rag];
  const previous = history.length >= 2 ? history[history.length - 2] : undefined;
  const risks = c.risks.filter((r) => has(r.title));
  const decisions = c.decisions.filter(has);
  const next = c.next_30_days.filter(has);
  const month = periodLabel(period);

  return (
    <div className="space-y-4">
      {/* Hero: rating, posture and the month's headline */}
      <EditCtx.Provider value={editing}>
      <Editable k="cover">
      <section className={`panel break-inside-avoid overflow-hidden`}>
        <div className="grid gap-0 md:grid-cols-[220px_1fr] print:grid-cols-[200px_1fr]">
          <div className={`${rag.bg} ${rag.text} flex flex-col justify-center px-5 py-5`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Overall rating</div>
            <div className="mt-1 text-3xl font-extrabold tracking-tight">{RAG_LABELS[c.rag]}</div>
            {has(c.posture_callout) && <div className="mt-1 text-sm font-semibold">{c.posture_callout}</div>}
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {month}
              {status === "draft" && <span className="rounded border border-dashed border-slate-400 px-1.5 py-px normal-case tracking-normal">Draft</span>}
            </div>
            <h2 className="mt-0.5 hidden text-xl font-bold tracking-tight text-slate-900 print:block dark:text-white">{title}</h2>
            {has(c.posture) && <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">Risk posture: {c.posture}</p>}
            {has(c.ranking) && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">{c.ranking}</p>}
            {(has(c.prepared_for) || has(c.prepared_by)) && (
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                {has(c.prepared_for) && <>For <b className="font-medium text-slate-700 dark:text-slate-200">{c.prepared_for}</b></>}
                {has(c.prepared_for) && has(c.prepared_by) && " · "}
                {has(c.prepared_by) && <>Prepared by <b className="font-medium text-slate-700 dark:text-slate-200">{c.prepared_by}</b></>}
              </p>
            )}
          </div>
        </div>
      </section>
      </Editable>

      {snapshot && <Kpis snapshot={snapshot} previous={previous} />}

      {(has(c.leadership_assessment) || has(c.business_implications) || editing) && (
        <Editable k="summary">
        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          {has(c.leadership_assessment) && (
            <Panel title="Leadership assessment" icon={Sparkles}>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-200">{c.leadership_assessment}</p>
            </Panel>
          )}
          {has(c.business_implications) && (
            <Panel title="Business implications" icon={ShieldAlert}>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-200">{c.business_implications}</p>
            </Panel>
          )}
        </div>
        </Editable>
      )}

      {snapshot && (
        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          <Panel title="Alerts by risk level" icon={Layers} hint={`${snapshot.total_alerts} active alerts in the register`}>
            <BandChart snapshot={snapshot} />
          </Panel>
          <Panel title="Month-by-month trend" icon={ArrowUpRight} hint="Critical, high and overdue alerts at each monthly report">
            <TrendChart history={history} />
          </Panel>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
        <Editable k="priorities">
          <Panel title="Priority map" icon={Flag} hint="Regulation groups by risk level and change since last month" className="h-full">
            <PriorityMap content={c} />
          </Panel>
        </Editable>
        <Editable k="scorecard">
          <Panel title="Scorecard" icon={ListChecks} className="h-full">
            <ScorecardProgress content={c} />
          </Panel>
        </Editable>
      </div>

      {snapshot && (
        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          <Panel title="Upcoming compliance deadlines" icon={CalendarClock} hint="Alerts with a deadline in each of the next six months">
            <DeadlineChart deadlines={snapshot.deadlines} />
          </Panel>
          <Panel title="Alerts by regulation group" icon={Layers} hint="Sub-groups are counted in their top-level group">
            <GroupChart groups={snapshot.by_group} />
          </Panel>
        </div>
      )}

      {(decisions.length > 0 || editing) && (
        <Editable k="decisions">
        <section className="panel break-inside-avoid border-red-200 p-4 sm:p-5 dark:border-red-500/30">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <Gavel className="h-4 w-4" /> Decisions and sponsorship requested
          </h3>
          <ol className="grid gap-2 sm:grid-cols-2 print:grid-cols-2">
            {decisions.map((d, i) => (
              <li key={i} className="flex gap-3 rounded-lg bg-red-50/70 p-3 text-sm text-slate-800 dark:bg-red-500/5 dark:text-slate-100">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">{i + 1}</span>
                <span className="whitespace-pre-line">{d}</span>
              </li>
            ))}
          </ol>
          {decisions.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No decisions needed this month.</p>}
        </section>
        </Editable>
      )}


      {(risks.length > 0 || editing) && (
        <Editable k="risks">
        <section className="panel p-4 sm:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <ShieldAlert className="h-4 w-4 text-slate-400" /> Top risks
          </h3>
          {risks.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No critical or high risks this month.</p>}
          <ol className="divide-y divide-[var(--border)]">
            {risks.map((r, i) => {
              const color = r.level ? LEVEL_COLOR[r.level] : "#94a3b8";
              const titleEl = r.alert_id
                ? <Link href={`/alerts/${r.alert_id}`} className="hover:text-blue-700 hover:underline dark:hover:text-blue-300">{r.title}</Link>
                : r.title;
              return (
                <li key={i} className="flex break-inside-avoid gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white" style={{ background: color }}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{titleEl}</span>
                      {r.level && <span className="text-[11px] font-semibold" style={{ color }}>{LEVEL_LABELS[r.level]}</span>}
                    </div>
                    {has(r.evidence) && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{r.evidence}</p>}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-700 dark:text-slate-200">
                      {has(r.next_actions) && (
                        <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-slate-400" />{r.next_actions}</span>
                      )}
                      {has(r.leadership_role) && (
                        <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5 text-slate-400" />{r.leadership_role}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
        </Editable>
      )}

      {(next.length > 0 || editing) && (
        <Editable k="next_30_days">
          <Panel title="Next 30 days" icon={CalendarClock}>
            <ul className="space-y-1.5">
              {next.map((t, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-slate-700 dark:text-slate-200">
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded border-2 border-slate-300 dark:border-slate-600" aria-hidden="true" />
                  <span className="whitespace-pre-line">{t}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </Editable>
      )}
      </EditCtx.Provider>

      <p className="text-xs text-[var(--muted-foreground)]">
        {snapshot
          ? `Generated from the RiskOrbit alert register as of ${new Date(`${snapshot.as_of}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`
          : "Generated from the RiskOrbit alert register."}
        {has(c.scorecard_note) && ` ${c.scorecard_note}`}
      </p>
    </div>
  );
}
