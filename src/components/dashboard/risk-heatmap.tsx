"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface HeatmapGroup {
  id: string | null;
  name: string;
  alert_count: number;
  resources: number;
  urgency: number;
  critical: number;
  high: number;
  top_score: number;
}

export interface HeatmapAlert {
  id: string;
  title: string;
  ref: string | null;
  priority: string;
  score: number | null;
  resources: number;
  urgency: number;
  group_name: string | null;
}

export interface HeatmapData {
  groups: HeatmapGroup[];
  alerts: HeatmapAlert[];
  not_placed: number;
}

export type HeatmapView = "groups" | "alerts";

/** Scale labels for the 1 / 3 / 6 / 9 ratings, taken from the scoring policy. */
const RESOURCE_TICKS = [
  { v: 1, label: "< $25k" },
  { v: 3, label: "$25k–250k" },
  { v: 6, label: "$250k–1M" },
  { v: 9, label: "> $1M" },
];
const URGENCY_TICKS = [
  { v: 1, label: "> 36 mo" },
  { v: 3, label: "18–36 mo" },
  { v: 6, label: "6–18 mo" },
  { v: 9, label: "≤ 6 mo" },
];

const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical", high: "High", moderate: "Moderate", low: "Low", unscored: "Unscored",
};

const M = { top: 14, right: 14, bottom: 52, left: 84 };
const DOMAIN = 10;

interface Point {
  key: string;
  x: number;
  y: number;
  r: number;
  label: string;
  showLabel: boolean;
  dashed: boolean;
  group?: HeatmapGroup;
  alert?: HeatmapAlert;
  /** Several groups at the same spot, drawn as one bubble */
  cluster?: { members: HeatmapGroup[]; alerts: number; urgency: number; resources: number };
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Greedy label placement: above, below, right, left; skip if nothing fits. */
function placeLabels(points: Point[], w: number, h: number) {
  // Dots are obstacles too, so labels never cover another mark
  const boxes: { x: number; y: number; w: number; h: number }[] = points.map((p) => ({
    x: p.x - p.r - 1, y: p.y - p.r - 1, w: p.r * 2 + 2, h: p.r * 2 + 2,
  }));
  const hit = (b: { x: number; y: number; w: number; h: number }) =>
    b.x < 0 || b.y < 0 || b.x + b.w > w || b.y + b.h > h ||
    boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  const out = new Map<string, { x: number; y: number; anchor: "middle" | "start" | "end" }>();
  for (const p of points) {
    if (!p.showLabel) continue;
    const tw = p.label.length * 6.3 + 6;
    const th = 15;
    const options = [
      { bx: p.x - tw / 2, by: p.y - p.r - th - 2, tx: p.x, ty: p.y - p.r - 6, anchor: "middle" as const },
      { bx: p.x - tw / 2, by: p.y + p.r + 2, tx: p.x, ty: p.y + p.r + 13, anchor: "middle" as const },
      { bx: p.x + p.r + 4, by: p.y - th / 2, tx: p.x + p.r + 6, ty: p.y + 4, anchor: "start" as const },
      { bx: p.x - p.r - 4 - tw, by: p.y - th / 2, tx: p.x - p.r - 6, ty: p.y + 4, anchor: "end" as const },
    ];
    for (const o of options) {
      const b = { x: o.bx, y: o.by, w: tw, h: th };
      if (!hit(b)) {
        boxes.push(b);
        out.set(p.key, { x: o.tx, y: o.ty, anchor: o.anchor });
        break;
      }
    }
  }
  return out;
}

export function RiskHeatmap({
  data,
  view,
  onSelectGroup,
  onSelectAlert,
  fill = false,
}: {
  data: HeatmapData;
  view: HeatmapView;
  onSelectGroup: (id: string | null) => void;
  onSelectAlert: (id: string) => void;
  /** Fill the parent's height (full-screen view) instead of a fixed height. */
  fill?: boolean;
}) {
  const gid = useId().replace(/:/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  // Cluster spread out after a click (its groups are shown one by one around it)
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = size.w;
  const height = fill ? Math.max(300, size.h) : width && width < 520 ? 340 : 420;
  // More room means more labels
  const labelCount = fill ? 14 : 6;
  const pw = Math.max(0, width - M.left - M.right);
  const ph = height - M.top - M.bottom;
  const sx = (v: number) => (v / DOMAIN) * pw;
  const sy = (v: number) => ph - (v / DOMAIN) * ph;

  const points = ((): Point[] => {
    if (!pw) return [];
    if (view === "groups") {
      const bubble = (n: number) => Math.min(20, Math.max(8, 6 + Math.sqrt(n) * 2));
      // Groups at the same spot would hide each other: one bubble per spot ("12 groups"),
      // with "Not in a group" kept apart so it never covers a real group
      // Bubbles that would overlap on screen join one cluster (biggest groups anchor the clusters)
      const cells = new Map<string, HeatmapGroup[]>();
      const anchors: Array<{ cell: string; x: number; y: number }> = [];
      const real = data.groups.filter((g) => g.id !== null).sort((a, b) => b.alert_count - a.alert_count);
      for (const g of real) {
        const x = sx(g.resources), y = sy(g.urgency);
        const near = anchors.find((a) => Math.hypot(a.x - x, a.y - y) < 22);
        const cell = near ? near.cell : `${g.resources}|${g.urgency}`;
        if (!near) anchors.push({ cell, x, y });
        if (!cells.has(cell)) cells.set(cell, []);
        cells.get(cell)!.push(g);
      }
      const out: Point[] = [];
      const clusterAt = new Map<string, Point>();
      for (const [cell, members] of cells) {
        if (members.length === 1) {
          const g = members[0];
          out.push({ key: `g-${g.id}`, x: sx(g.resources), y: sy(g.urgency), r: bubble(g.alert_count), label: truncate(g.name, 34), showLabel: true, dashed: false, group: g });
          continue;
        }
        const sorted = [...members].sort((a, b) => b.alert_count - a.alert_count || b.top_score - a.top_score);
        const alerts = sorted.reduce((n, g) => n + g.alert_count, 0);
        // Centre on the alert-weighted average of its groups
        const rx = Math.round((sorted.reduce((n, g) => n + g.resources * g.alert_count, 0) / alerts) * 10) / 10;
        const uy = Math.round((sorted.reduce((n, g) => n + g.urgency * g.alert_count, 0) / alerts) * 10) / 10;
        const p: Point = {
          key: `c-${cell}`,
          x: sx(rx),
          y: sy(uy),
          r: Math.min(26, Math.max(12, 8 + Math.sqrt(alerts) * 2)),
          label: `${members.length} groups`,
          showLabel: true,
          dashed: false,
          cluster: { members: sorted, alerts, urgency: uy, resources: rx },
        };
        out.push(p);
        clusterAt.set(cell, p);
      }
      const none = data.groups.find((g) => g.id === null);
      if (none) {
        const r = bubble(none.alert_count);
        let x = sx(none.resources);
        const y = sy(none.urgency);
        const near = clusterAt.get(`${Math.round(none.resources * 4) / 4}|${Math.round(none.urgency * 4) / 4}`) ??
          out.find((p) => Math.hypot(p.x - x, p.y - y) < p.r + r);
        if (near) x = near.x + near.r + r + 6 < pw ? near.x + near.r + r + 6 : near.x - near.r - r - 6;
        out.push({ key: "g-none", x, y, r, label: "Not in a group", showLabel: true, dashed: true, group: none });
      }
      return out;
    }
    // Alerts share a handful of rating combinations, so spread each cell in a sunflower pattern
    const cells = new Map<string, number>();
    const labelled = new Set(data.alerts.slice(0, labelCount).map((a) => a.id));
    return data.alerts.map((a) => {
      const cell = `${a.resources}-${a.urgency}`;
      const k = cells.get(cell) ?? 0;
      cells.set(cell, k + 1);
      const rad = 7 * Math.sqrt(k);
      const ang = k * 2.39996;
      const r = a.priority === "critical" ? 6.5 : 5;
      const clamp = (v: number, max: number) => Math.min(max - r - 2, Math.max(r + 2, v));
      return {
        key: `a-${a.id}`,
        x: clamp(sx(a.resources) + rad * Math.cos(ang), pw),
        y: clamp(sy(a.urgency) + rad * Math.sin(ang), ph),
        r,
        label: truncate(a.title, 30),
        showLabel: labelled.has(a.id),
        dashed: false,
        alert: a,
      };
    });
  })();

  const spread = ((): Point[] => {
    const c = points.find((p) => p.key === expanded && p.cluster);
    if (!c?.cluster) return [];
    return c.cluster.members.map((g, k) => {
      const r = 6;
      const rad = c.r + 4 + 12 * Math.sqrt(k + 1) - 12;
      const ang = k * 2.39996 - Math.PI / 2;
      const clamp = (v: number, max: number) => Math.min(max - r - 2, Math.max(r + 2, v));
      return {
        key: `s-${g.id}`,
        x: clamp(c.x + rad * Math.cos(ang), pw),
        y: clamp(c.y + rad * Math.sin(ang), ph),
        r,
        label: truncate(g.name, 26),
        showLabel: false,
        dashed: false,
        group: g,
      };
    });
  })();
  const labels = placeLabels(points, pw, ph);
  const drawOrder = [...points].sort((a, b) => b.r - a.r);
  const hovered = [...spread, ...points].find((p) => p.key === hover) ?? null;

  const empty = view === "groups" ? data.groups.length === 0 : data.alerts.length === 0;

  return (
    <div className={fill ? "relative flex h-full w-full flex-col" : "relative w-full"}>
    <div ref={wrap} className={fill ? "relative min-h-0 w-full flex-1" : "relative w-full"} style={fill ? undefined : { height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Risk heatmap of ${view === "groups" ? "regulation groups" : "alerts"}: urgency against resources needed. Top right needs action first.`}
          className="select-none"
        >
          <defs>
            <linearGradient id={`hm-${gid}`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#16a34a" />
              <stop offset="30%" stopColor="#facc15" />
              <stop offset="58%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#b91c1c" />
            </linearGradient>
          </defs>
          <g transform={`translate(${M.left},${M.top})`}>
            <rect width={pw} height={ph} rx={8} fill={`url(#hm-${gid})`} />
            {/* Grid at the rating steps */}
            {RESOURCE_TICKS.map((t) => (
              <line key={`gx${t.v}`} x1={sx(t.v)} x2={sx(t.v)} y1={0} y2={ph} stroke="#fff" strokeOpacity={0.35} strokeDasharray="3 4" />
            ))}
            {URGENCY_TICKS.map((t) => (
              <line key={`gy${t.v}`} x1={0} x2={pw} y1={sy(t.v)} y2={sy(t.v)} stroke="#fff" strokeOpacity={0.35} strokeDasharray="3 4" />
            ))}

            {/* Axes */}
            {RESOURCE_TICKS.map((t) => (
              <text key={`tx${t.v}`} x={sx(t.v)} y={ph + 18} textAnchor="middle" className="fill-slate-500 text-[11px] dark:fill-slate-400">
                {pw < 380 ? t.v : t.label}
              </text>
            ))}
            {URGENCY_TICKS.map((t) => (
              <text key={`ty${t.v}`} x={-10} y={sy(t.v) + 4} textAnchor="end" className="fill-slate-500 text-[11px] dark:fill-slate-400">{t.label}</text>
            ))}
            <text x={pw / 2} y={ph + 42} textAnchor="middle" className="fill-slate-700 text-[12px] font-semibold dark:fill-slate-200">
              Resources needed <tspan className="font-normal fill-slate-500 dark:fill-slate-400">(cost to implement)</tspan>
            </text>
            <text transform={`translate(${-70},${ph / 2}) rotate(-90)`} textAnchor="middle" className="fill-slate-700 text-[12px] font-semibold dark:fill-slate-200">
              Urgency <tspan className="font-normal fill-slate-500 dark:fill-slate-400">(time to deadline)</tspan>
            </text>

            {/* Marks */}
            {drawOrder.map((p) => {
              const active = hover === p.key;
              return (
                <g
                  key={p.key}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(p.key)}
                  onMouseLeave={() => setHover((h) => (h === p.key ? null : h))}
                  onClick={() => {
                    if (p.cluster) setExpanded((e) => (e === p.key ? null : p.key));
                    else if (p.group) onSelectGroup(p.group.id);
                    else if (p.alert) onSelectAlert(p.alert.id);
                  }}
                  role="button"
                  aria-label={p.cluster ? `${p.cluster.members.length} regulation groups at the same spot, ${p.cluster.alerts} alerts. Click to show them one by one.` : p.label}
                >
                  <circle cx={p.x} cy={p.y} r={p.r + 6} fill="transparent" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={active ? p.r + 1.5 : p.r}
                    fill={p.dashed ? "#334155" : p.cluster ? "#1e3a8a" : "#0b1f45"}
                    fillOpacity={view === "alerts" ? 0.9 : expanded && expanded !== p.key ? 0.45 : 1}
                    stroke="#fff"
                    strokeWidth={p.cluster ? 2.5 : 2}
                    strokeDasharray={p.dashed ? "3 2" : undefined}
                  />
                  {p.cluster && <circle cx={p.x} cy={p.y} r={p.r + 4} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="2 3" />}
                  {view === "groups" && (p.group || p.cluster) && p.r >= 11 && (
                    <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="pointer-events-none fill-white text-[10px] font-bold tabular-nums">
                      {p.cluster ? p.cluster.members.length : p.group!.alert_count}
                    </text>
                  )}
                </g>
              );
            })}

            {/* The groups inside a clicked cluster */}
            {spread.map((p) => (
              <g
                key={p.key}
                className="cursor-pointer"
                onMouseEnter={() => setHover(p.key)}
                onMouseLeave={() => setHover((h) => (h === p.key ? null : h))}
                onClick={() => p.group && onSelectGroup(p.group.id)}
                role="button"
                aria-label={`${p.group?.name}: ${p.group?.alert_count} alerts`}
              >
                <circle cx={p.x} cy={p.y} r={p.r + 5} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={hover === p.key ? p.r + 1.5 : p.r} fill="#0b1f45" stroke="#fff" strokeWidth={2} />
              </g>
            ))}

            {/* Labels on top of every mark */}
            {points.map((p) => {
              const l = labels.get(p.key);
              if (!l) return null;
              return (
                <text
                  key={`l-${p.key}`}
                  x={l.x}
                  y={l.y}
                  textAnchor={l.anchor}
                  className={`pointer-events-none fill-white text-[11px] font-semibold ${p.dashed ? "italic" : ""}`}
                  style={{ paintOrder: "stroke", stroke: "rgba(15,23,42,0.55)", strokeWidth: 3, strokeLinejoin: "round" }}
                >
                  {p.label}
                </text>
              );
            })}

            {empty && (
              <text x={pw / 2} y={ph / 2} textAnchor="middle" className="fill-white text-sm font-semibold">
                No alerts have both a cost and an urgency rating yet
              </text>
            )}
          </g>
        </svg>
      )}

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900"
          style={{
            left: Math.min(Math.max(8, M.left + hovered.x - 128), width - 264),
            top: M.top + hovered.y + (hovered.y > ph / 2 ? -hovered.r - 12 : hovered.r + 12),
            transform: hovered.y > ph / 2 ? "translateY(-100%)" : undefined,
          }}
        >
          {hovered.cluster ? (
            <>
              <p className="font-semibold text-slate-900 dark:text-white">{hovered.cluster.members.length} regulation groups at the same spot</p>
              <p className="mt-0.5 text-slate-500">
                {hovered.cluster.alerts} alerts · urgency {hovered.cluster.urgency} / 9 · resources {hovered.cluster.resources} / 9
              </p>
              <ul className="mt-2 space-y-0.5 text-slate-700 dark:text-slate-300">
                {hovered.cluster.members.slice(0, 8).map((g) => (
                  <li key={g.id} className="flex justify-between gap-2">
                    <span className="truncate">{g.name}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{g.alert_count}</span>
                  </li>
                ))}
                {hovered.cluster.members.length > 8 && <li className="text-slate-500">+{hovered.cluster.members.length - 8} more</li>}
              </ul>
              <p className="mt-2 text-[11px] text-blue-600 dark:text-blue-400">{expanded === hovered.key ? "Click to close" : "Click to show them one by one"}</p>
            </>
          ) : hovered.group ? (
            <>
              <p className="font-semibold text-slate-900 dark:text-white">{hovered.group.name}</p>
              <p className="mt-0.5 text-slate-500">
                {hovered.group.alert_count} alert{hovered.group.alert_count === 1 ? "" : "s"}
                {hovered.group.critical + hovered.group.high > 0 && ` · ${hovered.group.critical} critical, ${hovered.group.high} high`}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-600 dark:text-slate-300">
                <dt>Avg. urgency</dt><dd className="text-right font-semibold tabular-nums text-slate-900 dark:text-white">{hovered.group.urgency.toFixed(1)} / 9</dd>
                <dt>Avg. resources</dt><dd className="text-right font-semibold tabular-nums text-slate-900 dark:text-white">{hovered.group.resources.toFixed(1)} / 9</dd>
                <dt>Highest score</dt><dd className="text-right font-semibold tabular-nums text-slate-900 dark:text-white">{hovered.group.top_score}</dd>
              </dl>
              <p className="mt-2 text-[11px] text-blue-600 dark:text-blue-400">Click to see these alerts</p>
            </>
          ) : hovered.alert ? (
            <>
              <p className="font-semibold leading-snug text-slate-900 dark:text-white">{hovered.alert.title}</p>
              <p className="mt-0.5 text-slate-500">
                {[hovered.alert.ref, hovered.alert.group_name].filter(Boolean).join(" · ") || "Not in a group"}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-600 dark:text-slate-300">
                <dt>Priority</dt><dd className="text-right font-semibold text-slate-900 dark:text-white">{PRIORITY_LABEL[hovered.alert.priority] ?? hovered.alert.priority}</dd>
                <dt>Urgency</dt><dd className="text-right font-semibold tabular-nums text-slate-900 dark:text-white">{hovered.alert.urgency} / 9 · {URGENCY_TICKS.find((t) => t.v === hovered.alert!.urgency)?.label}</dd>
                <dt>Resources</dt><dd className="text-right font-semibold tabular-nums text-slate-900 dark:text-white">{hovered.alert.resources} / 9 · {RESOURCE_TICKS.find((t) => t.v === hovered.alert!.resources)?.label}</dd>
                <dt>Score</dt><dd className="text-right font-semibold tabular-nums text-slate-900 dark:text-white">{hovered.alert.score ?? "—"}</dd>
              </dl>
              <p className="mt-2 text-[11px] text-blue-600 dark:text-blue-400">Click to open</p>
            </>
          ) : null}
        </div>
      )}

    </div>
      {/* Colour key */}
      <div className="mt-1 flex items-center justify-end gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400" aria-hidden>
        <span>Monitor</span>
        <span className="h-2 w-24 rounded-full bg-gradient-to-r from-[#16a34a] via-[#facc15] via-50% to-[#b91c1c]" />
        <span>Act first</span>
      </div>

      {/* Same data as a table for screen readers */}
      <div className="sr-only">
      <table>
        <caption>Risk heatmap data</caption>
        <thead><tr><th>Name</th><th>Urgency (1–9)</th><th>Resources (1–9)</th><th>Alerts</th></tr></thead>
        <tbody>
          {view === "groups"
            ? data.groups.map((g) => <tr key={g.id ?? "none"}><td>{g.name}</td><td>{g.urgency}</td><td>{g.resources}</td><td>{g.alert_count}</td></tr>)
            : data.alerts.map((a) => <tr key={a.id}><td>{a.title}</td><td>{a.urgency}</td><td>{a.resources}</td><td>1</td></tr>)}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/** Items closest to the top-right corner: most urgent and most demanding first. */
export function heatmapFocus(data: HeatmapData, view: HeatmapView) {
  const rank = (u: number, r: number) => u * 2 + r;
  if (view === "groups") {
    return [...data.groups]
      .sort((a, b) => rank(b.urgency, b.resources) - rank(a.urgency, a.resources))
      .map((g) => ({ key: g.id ?? "none", name: g.name, urgency: g.urgency, resources: g.resources, meta: `${g.alert_count} alerts`, group: g }));
  }
  return [...data.alerts]
    .sort((a, b) => rank(b.urgency, b.resources) - rank(a.urgency, a.resources) || (b.score ?? 0) - (a.score ?? 0))
    .map((a) => ({ key: a.id, name: a.title, urgency: a.urgency, resources: a.resources, meta: PRIORITY_LABEL[a.priority] ?? a.priority, alert: a }));
}
