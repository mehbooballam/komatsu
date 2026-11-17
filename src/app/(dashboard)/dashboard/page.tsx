"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { WorldMap } from "@/components/dashboard/world-map";
import { ParetoChart } from "@/components/dashboard/pareto-chart";
import { AlertTriangle, Clock, FileWarning, BarChart3, Loader2 } from "lucide-react";

interface SummaryData {
  total_alerts: number;
  critical_count: number;
  due_soon_count: number;
  needs_review_count: number;
  last_import_date: string | null;
  as_of_date: string;
}

interface MapData {
  countries: Array<{
    code: string;
    iso_code: string;
    display_name: string;
    alert_count: number;
    highest_priority: string;
    by_band: { critical: number; high: number; moderate: number; low: number; unscored: number };
  }>;
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

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  onClick,
  loading,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
  loading?: boolean;
}) {
  const colorMap: Record<string, string> = {
    purple: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800",
    orange: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    gray: "bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  };

  const iconColorMap: Record<string, string> = {
    purple: "text-purple-600 dark:text-purple-400",
    orange: "text-orange-600 dark:text-orange-400",
    amber: "text-amber-600 dark:text-amber-400",
    gray: "text-gray-600 dark:text-gray-400",
  };

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-4 rounded-xl border p-4 transition-all hover:shadow-md ${colorMap[color]} text-left w-full`}
    >
      <div className={`rounded-lg p-2.5 ${iconColorMap[color]} bg-white/60 dark:bg-black/20`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-bold tabular-nums">
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : value.toLocaleString()}
        </div>
        <div className="text-xs font-medium opacity-80">{title}</div>
      </div>
    </button>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [paretoData, setParetoData] = useState<ParetoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, mapRes, paretoRes] = await Promise.all([
        fetch("/api/dashboard/summary"),
        fetch("/api/dashboard/map"),
        fetch("/api/dashboard/pareto"),
      ]);

      if (summaryRes.status === 401) {
        router.push("/login");
        return;
      }

      if (!summaryRes.ok || !mapRes.ok || !paretoRes.ok) {
        throw new Error("Failed to load dashboard data");
      }

      const [summaryJson, mapJson, paretoJson] = await Promise.all([
        summaryRes.json(),
        mapRes.json(),
        paretoRes.json(),
      ]);

      setSummary(summaryJson);
      setMapData(mapJson);
      setParetoData(paretoJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCountryClick = (code: string) => {
    if (code === "unmapped") {
      router.push("/alerts?geography=unmapped");
    } else {
      router.push(`/alerts?geography=${code}`);
    }
  };

  const handleBarClick = (alertId: string) => {
    router.push(`/alerts/${alertId}`);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-gray-500 dark:text-gray-400">
        <FileWarning className="h-12 w-12 mb-3 text-red-400" />
        <p className="text-lg font-medium mb-1">Failed to load dashboard</p>
        <p className="text-sm mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
            {summary && (
              <>
                <span>Scores as of {summary.as_of_date}</span>
                {summary.last_import_date && (
                  <>
                    <span>·</span>
                    <span>
                      Last import:{" "}
                      {new Date(summary.last_import_date).toLocaleDateString()}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Alerts"
          value={summary?.total_alerts ?? 0}
          icon={BarChart3}
          color="gray"
          loading={loading}
          onClick={() => router.push("/alerts")}
        />
        <StatCard
          title="Critical Priority"
          value={summary?.critical_count ?? 0}
          icon={AlertTriangle}
          color="purple"
          loading={loading}
          onClick={() => router.push("/alerts?priority=critical")}
        />
        <StatCard
          title="Due Within 30 Days"
          value={summary?.due_soon_count ?? 0}
          icon={Clock}
          color="orange"
          loading={loading}
          onClick={() => router.push("/alerts?deadline_within=30")}
        />
        <StatCard
          title="Needs Review"
          value={summary?.needs_review_count ?? 0}
          icon={FileWarning}
          color="amber"
          loading={loading}
          onClick={() => router.push("/alerts?needs_review=true")}
        />
      </div>

      {/* Map & Pareto */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-5">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : mapData ? (
            <WorldMap
              countries={mapData.countries}
              unmappedCount={mapData.unmapped_count}
              onCountryClick={handleCountryClick}
            />
          ) : null}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-5">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : paretoData ? (
            <ParetoChart
              data={paretoData.data}
              totalSum={paretoData.total_sum}
              totalScoredCount={paretoData.total_scored_count}
              displayedCount={paretoData.displayed_count}
              onBarClick={handleBarClick}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
