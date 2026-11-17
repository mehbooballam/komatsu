"use client";

import {
  BarChart,
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
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#7c3aed",
  high: "#c2410c",
  moderate: "#d97706",
  low: "#0d9488",
  unscored: "#6b7280",
};

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ParetoItem }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-gray-900 dark:text-gray-100 mb-1 max-w-[200px] truncate">
        {item.title}
      </div>
      <div className="text-gray-500 dark:text-gray-400 mb-1">{item.external_alert_id}</div>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.unscored }}
        />
        <span className="capitalize">{item.priority}</span>
      </div>
      <div>Score: {item.score}</div>
      <div>Cumulative: {item.cumulative_pct}%</div>
    </div>
  );
}

export function ParetoChart({
  data,
  totalSum,
  totalScoredCount,
  displayedCount,
  onBarClick,
}: ParetoChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-600">
        <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <p className="text-sm">No scored alerts to display</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Pareto by Risk Score
        </h3>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {displayedCount < totalScoredCount
            ? `Top ${displayedCount} of ${totalScoredCount} scored alerts`
            : `${totalScoredCount} scored alerts`}
          {" · "}Total: {totalSum.toLocaleString()}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart
          data={data}
          margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
          barCategoryGap="10%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="external_alert_id"
            tick={{ fontSize: 10 }}
            interval={data.length > 20 ? Math.floor(data.length / 10) : 0}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            yAxisId="left"
            orientation="left"
            tick={{ fontSize: 11 }}
            label={{
              value: "Score",
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 11, fill: "#6b7280" },
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            label={{
              value: "Cumulative %",
              angle: 90,
              position: "insideRight",
              style: { fontSize: 11, fill: "#6b7280" },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            yAxisId="left"
            dataKey="score"
            radius={[2, 2, 0, 0]}
            cursor="pointer"
            onClick={(_data: unknown, _index: number, e: React.MouseEvent) => {
              const d = _data as { alert_id?: string };
              if (d?.alert_id) onBarClick?.(d.alert_id);
            }}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={PRIORITY_COLORS[entry.priority] || PRIORITY_COLORS.unscored}
              />
            ))}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulative_pct"
            stroke="#374151"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#374151" }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-600 dark:text-gray-400">
        {(["critical", "high", "moderate", "low"] as const).map((band) => (
          <div key={band} className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: PRIORITY_COLORS[band] }}
            />
            <span className="capitalize">{band}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-0.5 bg-gray-700 dark:bg-gray-300" />
          <span>Cumulative %</span>
        </div>
      </div>
    </div>
  );
}
