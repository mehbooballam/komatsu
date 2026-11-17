"use client";

import { useEffect, useState } from "react";
import {
  X,
  ExternalLink,
  Calendar,
  Clock,
  User,
  Tag,
  FileText,
  ChevronRight,
  AlertTriangle,
  Loader2,
  Pencil,
  Link2,
  Search,
  Package,
} from "lucide-react";

interface AlertDetail {
  alert: {
    id: string;
    external_alert_id: string;
    title: string;
    overview: string;
    summary: string;
    relevance: string;
    published_on: string;
    stage: string;
    recommendation: string;
    change_type: string;
    timing_raw: string;
    product_raw: string;
    jurisdiction_raw: string;
    agency_name: string;
    source_name: string;
    source_url: string;
    topic_match: string;
    local_state: string;
    record_version: number;
    group_id: string;
    group_title: string;
    ownership: {
      type: string;
      effective_owner_name: string | null;
      direct_owner_name: string | null;
      group_owner_name: string | null;
    };
  };
  assessment: {
    effective_market_access: number | null;
    effective_cost_to_implement: number | null;
    effective_human_resources: number | null;
    effective_urgency: number | null;
    raw_total: number | null;
    effective_total: number | null;
    base_band: string | null;
    effective_band: string | null;
    escalation_reasons: Array<{ reason: string; description: string }>;
    review_flags: Array<{ flag: string; description: string }>;
    days_remaining: number | null;
    margin_days: number | null;
    as_of_date: string;
  } | null;
  deadlines: Array<{
    id: string;
    kind: string;
    date_value: string;
    verification_state: string;
    lifecycle_state: string;
    applies_to: string;
  }>;
  source_factors: Array<{
    factor_key: string;
    original_value: string;
    parsed_value: number | null;
    rationale: string;
  }>;
  active_overrides: Array<{
    target: string;
    value: number;
    reason: string;
    expires_at: string | null;
  }>;
  products: Array<{
    family_name: string;
    product_name: string;
    state: string;
    model_code: string;
  }>;
  geographies: Array<{
    display_name: string;
    code: string;
    state: string;
  }>;
  topics: Array<{ normalized_key: string; source_label: string }>;
  tags: Array<{ tag_name: string; color: string }>;
  forecast: {
    remaining_days: number;
    estimated_finish_date: string;
    as_of_date: string;
    reason: string;
  } | null;
  source_revisions: Array<{
    version_number: number;
    observed_at: string;
    original_filename: string;
    source_payload: Record<string, unknown>;
  }>;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-800 dark:text-purple-200", border: "border-purple-300 dark:border-purple-700" },
  high: { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-800 dark:text-orange-200", border: "border-orange-300 dark:border-orange-700" },
  moderate: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-800 dark:text-amber-200", border: "border-amber-300 dark:border-amber-700" },
  low: { bg: "bg-teal-100 dark:bg-teal-900/40", text: "text-teal-800 dark:text-teal-200", border: "border-teal-300 dark:border-teal-700" },
  unscored: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-400", border: "border-gray-300 dark:border-gray-700" },
};

const FACTOR_LABELS: Record<string, string> = {
  market_access: "Market Access (A)",
  cost_to_implement: "Cost to Implement (B)",
  human_resources: "Additional People (C)",
  urgency: "Live Urgency (D)",
};

function PriorityBadge({ priority }: { priority: string }) {
  const colors = PRIORITY_COLORS[priority] || PRIORITY_COLORS.unscored;
  const icon = priority === "critical" || priority === "high" ? (
    <AlertTriangle className="h-3 w-3" />
  ) : null;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}>
      {icon}
      <span className="capitalize">{priority}</span>
    </span>
  );
}

interface AlertDrawerProps {
  alertId: string | null;
  onClose: () => void;
  userRole?: string;
  onEditScore?: (alertId: string) => void;
}

export function AlertDrawer({ alertId, onClose, userRole = "reviewer", onEditScore }: AlertDrawerProps) {
  const [data, setData] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (!alertId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/alerts/${alertId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load alert");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [alertId]);

  if (!alertId) return null;

  const isOpen = !!alertId;
  const canEdit = userRole !== "risk_owner";

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white dark:bg-gray-900 shadow-2xl transform transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Close drawer"
            >
              <X className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
              {data?.alert.external_alert_id}
            </span>
          </div>
          {data?.alert.source_url && (
            <a
              href={data.alert.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Open source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100vh-57px)] px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-64 text-red-500">
              <AlertTriangle className="h-8 w-8 mb-2" />
              <p>{error}</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-5">
              {/* Title & Priority */}
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 leading-tight">
                    {data.alert.title}
                  </h2>
                  <PriorityBadge priority={data.assessment?.effective_band || "unscored"} />
                </div>
                {data.alert.overview && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{data.alert.overview}</p>
                )}
              </div>

              {/* Score Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Score</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {data.assessment?.effective_total ?? "—"}
                  </div>
                  {data.assessment?.raw_total !== data.assessment?.effective_total &&
                    data.assessment?.raw_total != null && (
                      <div className="text-xs text-gray-400">Raw: {data.assessment.raw_total}</div>
                    )}
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Days Left</div>
                  <div className={`text-xl font-bold ${
                    data.assessment?.days_remaining != null && data.assessment.days_remaining <= 30
                      ? "text-orange-600 dark:text-orange-400"
                      : "text-gray-900 dark:text-gray-100"
                  }`}>
                    {data.assessment?.days_remaining ?? "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Stage</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {data.alert.stage || "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Margin</div>
                  <div className={`text-xl font-bold ${
                    data.assessment?.margin_days != null && data.assessment.margin_days < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-900 dark:text-gray-100"
                  }`}>
                    {data.assessment?.margin_days != null ? `${data.assessment.margin_days}d` : "—"}
                  </div>
                </div>
              </div>

              {/* Escalation reasons */}
              {data.assessment?.escalation_reasons && data.assessment.escalation_reasons.length > 0 && (
                <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-3">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-purple-800 dark:text-purple-200 mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    Escalation Applied
                  </div>
                  {data.assessment.escalation_reasons.map((r, i) => (
                    <div key={i} className="text-xs text-purple-700 dark:text-purple-300">
                      {r.description || r.reason}
                    </div>
                  ))}
                </div>
              )}

              {/* Tabs */}
              <div className="border-b border-gray-200 dark:border-gray-700">
                <div className="flex gap-1 -mb-px">
                  {["overview", "evidence", "history", "actions"].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab
                          ? "border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100"
                          : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                      }`}
                    >
                      <span className="capitalize">{tab}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab Content: Overview */}
              {activeTab === "overview" && (
                <div className="space-y-4">
                  {/* Factor Breakdown */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Factor Breakdown
                      </h4>
                      {canEdit && (
                        <button
                          onClick={() => onEditScore?.(data.alert.id)}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      )}
                    </div>
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-800/50">
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Factor</th>
                            <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Source</th>
                            <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Override</th>
                            <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Effective</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {(["market_access", "cost_to_implement", "human_resources", "urgency"] as const).map((key) => {
                            const sourceFactor = data.source_factors.find((f) => f.factor_key === key);
                            const override = data.active_overrides.find((o) => o.target === key);
                            const effectiveValue = data.assessment
                              ? (data.assessment as Record<string, unknown>)[`effective_${key}`]
                              : null;

                            return (
                              <tr key={key} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                                <td className="px-3 py-2 text-gray-700 dark:text-gray-300 text-xs">
                                  {FACTOR_LABELS[key]}
                                </td>
                                <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">
                                  {sourceFactor?.parsed_value ?? "—"}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {override ? (
                                    <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                                      {override.value}
                                      <Pencil className="h-2.5 w-2.5" />
                                    </span>
                                  ) : (
                                    <span className="text-gray-300 dark:text-gray-600">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center font-semibold text-gray-900 dark:text-gray-100">
                                  {effectiveValue != null ? String(effectiveValue) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {data.source_factors.length === 0 && !data.assessment?.effective_total && (
                        <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/30">
                          Unscored — no factor ratings available
                        </div>
                      )}
                    </div>
                    {/* Rationales */}
                    {data.source_factors.filter((f) => f.rationale).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {data.source_factors
                          .filter((f) => f.rationale)
                          .map((f) => (
                            <div key={f.factor_key} className="text-xs text-gray-500 dark:text-gray-400">
                              <span className="font-medium">{FACTOR_LABELS[f.factor_key]}:</span>{" "}
                              {f.rationale}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Deadlines */}
                  {data.deadlines.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
                        <Calendar className="h-4 w-4" /> Deadlines
                      </h4>
                      <div className="space-y-1.5">
                        {data.deadlines.map((d) => (
                          <div
                            key={d.id}
                            className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                d.kind === "compliance"
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                              }`}>
                                {d.kind}
                              </span>
                              <span className="text-gray-900 dark:text-gray-100">{d.date_value}</span>
                              {d.applies_to && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">({d.applies_to})</span>
                              )}
                            </div>
                            <span className={`text-xs ${
                              d.verification_state === "verified"
                                ? "text-green-600 dark:text-green-400"
                                : "text-amber-600 dark:text-amber-400"
                            }`}>
                              {d.verification_state}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Implementation Forecast */}
                  {data.forecast && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
                        <Clock className="h-4 w-4" /> Implementation Forecast
                      </h4>
                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-gray-400">Remaining days</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{data.forecast.remaining_days}</span>
                        </div>
                        {data.forecast.estimated_finish_date && (
                          <div className="flex justify-between">
                            <span className="text-gray-500 dark:text-gray-400">Est. finish</span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">{data.forecast.estimated_finish_date}</span>
                          </div>
                        )}
                        {data.forecast.reason && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{data.forecast.reason}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Summary */}
                  {data.alert.summary && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
                        <FileText className="h-4 w-4" /> Summary
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                        {data.alert.summary}
                      </p>
                    </div>
                  )}

                  {/* Relevance */}
                  {data.alert.relevance && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Relevance</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">{data.alert.relevance}</p>
                    </div>
                  )}

                  {/* Products */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
                      <Package className="h-4 w-4" /> Products
                    </h4>
                    {data.products.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {data.products.map((p, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              p.state === "confirmed"
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                            }`}
                          >
                            {p.family_name || p.product_name}
                            {p.state !== "confirmed" && " (to confirm)"}
                          </span>
                        ))}
                      </div>
                    ) : data.alert.product_raw ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-2.5 py-0.5 text-xs font-medium">
                        {data.alert.product_raw} — Product to confirm
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-600">No products linked</span>
                    )}
                  </div>

                  {/* Geography */}
                  {(data.geographies.length > 0 || data.alert.jurisdiction_raw) && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Geography</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {data.geographies.map((g, i) => (
                          <span key={i} className="inline-flex items-center rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2.5 py-0.5 text-xs font-medium">
                            {g.display_name}
                          </span>
                        ))}
                        {data.geographies.length === 0 && data.alert.jurisdiction_raw && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            Raw: {data.alert.jurisdiction_raw} (unmapped)
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tags & Topics */}
                  {(data.tags.length > 0 || data.topics.length > 0) && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
                        <Tag className="h-4 w-4" /> Tags & Topics
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {data.tags.map((t, i) => (
                          <span key={`tag-${i}`} className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border" style={{ borderColor: t.color, color: t.color }}>
                            {t.tag_name}
                          </span>
                        ))}
                        {data.topics.map((t, i) => (
                          <span key={`topic-${i}`} className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 px-2.5 py-0.5 text-xs">
                            {t.source_label || t.normalized_key}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ownership */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
                      <User className="h-4 w-4" /> Owner
                    </h4>
                    <div className="flex items-center gap-2 text-sm">
                      {data.alert.ownership.effective_owner_name ? (
                        <>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {data.alert.ownership.effective_owner_name}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                            ({data.alert.ownership.type})
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600">Unassigned</span>
                      )}
                    </div>
                    {data.alert.group_title && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1">
                        <ChevronRight className="h-3 w-3" />
                        Group: {data.alert.group_title}
                      </div>
                    )}
                  </div>

                  {/* Source Info */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
                      <Link2 className="h-4 w-4" /> Source
                    </h4>
                    <div className="text-sm space-y-1">
                      {data.alert.source_name && (
                        <div className="text-gray-600 dark:text-gray-400">
                          {data.alert.source_name}
                        </div>
                      )}
                      {data.alert.agency_name && (
                        <div className="text-gray-600 dark:text-gray-400">
                          Agency: {data.alert.agency_name}
                        </div>
                      )}
                      {data.alert.source_url && (
                        <a
                          href={data.alert.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs"
                        >
                          {data.alert.source_url} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab Content: Evidence */}
              {activeTab === "evidence" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Source evidence, citations and retrieved document content.
                  </p>
                  {data.source_revisions.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Source Versions</h4>
                      <div className="space-y-2">
                        {data.source_revisions.map((rev) => (
                          <div key={rev.version_number} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-gray-900 dark:text-gray-100">
                                Version {rev.version_number}
                              </span>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {new Date(rev.observed_at).toLocaleString()}
                              </span>
                            </div>
                            {rev.original_filename && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                From: {rev.original_filename}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab Content: History */}
              {activeTab === "history" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Score changes, imports, edits and assignment history.
                  </p>
                  <div className="text-sm text-gray-400 dark:text-gray-600 italic">
                    History is populated from audit events and score assessment changes.
                  </div>
                </div>
              )}

              {/* Tab Content: Actions */}
              {activeTab === "actions" && (
                <div className="space-y-3">
                  {canEdit ? (
                    <>
                      <button
                        onClick={() => onEditScore?.(data.alert.id)}
                        className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        <Pencil className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">Edit Ratings</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Override factor ratings with a reason</div>
                        </div>
                      </button>
                      <button className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <Calendar className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">Verify Deadline</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Confirm or classify deadline dates</div>
                        </div>
                      </button>
                      <button className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <User className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">Assign Owner</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Set direct alert or group owner</div>
                        </div>
                      </button>
                      <button className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <Search className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">Review Source</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Fetch and review source document</div>
                        </div>
                      </button>
                      <button className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <Package className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">Suggest Products</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">AI-suggested product matches</div>
                        </div>
                      </button>
                      <button className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <Link2 className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">Match to Regulation</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Link to regulation group</div>
                        </div>
                      </button>
                    </>
                  ) : (
                    <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                      Read-only view — editing requires a reviewer or higher role.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
