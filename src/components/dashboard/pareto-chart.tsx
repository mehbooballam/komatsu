"use client";

import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { BarChart3 } from "lucide-react";

interface ParetoItem {
  alert_id: string;
  external_alert_id: string;
  title: string;
  score: number;
  priority: string;
  cumulative_pct: number;
}

interface ParetoChartProps {
  data: ParetoItem[];
  totalSum: number;
  totalScoredCount: number;
  displayedCount: number;
  onBarClick?: (alertId: string) => void;
  /** Fill the parent's height (full-screen view) instead of a fixed 300px. */
  fill?: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#7c3aed",
  high: "#dc4a0c",
  moderate: "#f59e0b",
  low: "#14b8a6",
  unscored: "#94a3b8",
};

const LEGEND = ["critical", "high", "moderate", "low"] as const;

type Row = ParetoItem & { rank: number };

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="max-w-[260px] rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">#{item.rank}</div>
      <div className="mb-2 line-clamp-2 font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 capitalize text-slate-600 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.unscored }} />
          {item.priority}
        </span>
        <span className="font-semibold tabular-nums text-slate-900 dark:text-white">Score {item.score}</span>
      </div>
      <div className="mt-1 text-slate-500">Cumulative: {item.cumulative_pct}% of total risk</div>
      <div className="mt-1.5 text-[10px] text-blue-600">Click to open</div>
    </div>
  );
}

export function ParetoChart({ data, totalSum, onBarClick, fill = false }: ParetoChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-slate-400">
        <BarChart3 className="mb-2 h-10 w-10" />
        <p className="text-sm">No scored alerts to display</p>
      </div>
    );
  }

  const rows: Row[] = data.map((d, i) => ({ ...d, rank: i + 1 }));
  const tickEvery = rows.length > 100 ? 10 : rows.length > 25 ? 5 : rows.length > 12 ? 2 : 1;

  return (
    <div className={fill ? "flex h-full flex-col" : undefined}>
      <div className={fill ? "min-h-0 flex-1" : undefined}>
      <ResponsiveContainer width="100%" height={fill ? "100%" : 300}>
        <ComposedChart data={rows} margin={{ top: 8, right: 4, left: -12, bottom: 0 }} barCategoryGap="18%">
          <defs>
            <linearGradient id="paretoLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e8edf5" strokeDasharray="4 4" />
          <XAxis
            dataKey="rank"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
            interval={tickEvery - 1}
            tickFormatter={(v) => `#${v}`}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickFormatter={(v) => `${v}%`}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.06)" }} />
          <Bar
            yAxisId="left"
            dataKey="score"
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(d: unknown) => {
              const row = d as { alert_id?: string };
              if (row?.alert_id) onBarClick?.(row.alert_id);
            }}
          >
            {rows.map((entry) => (
              <Cell key={entry.alert_id} fill={PRIORITY_COLORS[entry.priority] || PRIORITY_COLORS.unscored} />
            ))}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulative_pct"
            stroke="url(#paretoLine)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: "#2563eb", stroke: "#fff", strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          {LEGEND.map((band) => (
            <span key={band} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PRIORITY_COLORS[band] }} />
              <span className="capitalize">{band}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded bg-gradient-to-r from-blue-600 to-indigo-600" />
            Cumulative %
          </span>
        </div>
        <span className="text-[var(--muted-foreground)]">Total risk score: {totalSum.toLocaleString()}</span>
      </div>
    </div>
  );
}
