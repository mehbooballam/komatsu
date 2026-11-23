"use client";

import { useState, useMemo } from "react";
import { X, AlertTriangle, RotateCcw } from "lucide-react";

interface FactorState {
  source: number | null;
  override: number | null;
  effective: number | null;
  rationale: string;
}

interface ScoreEditorProps {
  alertId: string;
  alertTitle: string;
  factors: Record<string, FactorState>;
  liveUrgency: number | null;
  onSave: (changes: Array<{ target: string; value: number; reason: string }>) => Promise<void>;
  onClearOverride: (target: string) => Promise<void>;
  onClose: () => void;
}

const FACTOR_LABELS: Record<string, { label: string; short: string; descriptions: Record<number, string> }> = {
  market_access: {
    label: "Market Access (A)",
    short: "A",
    descriptions: {
      1: "USD 0 to under 100,000",
      3: "USD 100,000 to 1,000,000",
      6: "Over USD 1,000,000 through 5,000,000",
      9: "Over USD 5,000,000",
    },
  },
  cost_to_implement: {
    label: "Cost to Implement (B)",
    short: "B",
    descriptions: {
      1: "USD 0 to under 25,000",
      3: "USD 25,000 to 250,000",
      6: "Over USD 250,000 through 1,000,000",
      9: "Over USD 1,000,000",
    },
  },
  human_resources: {
    label: "Additional People (C)",
    short: "C",
    descriptions: {
      1: "No additional FTE",
      3: "More than 0 through 5 FTE",
      6: "More than 5 through 10 FTE",
      9: "More than 10 FTE",
    },
  },
  urgency: {
    label: "Live Urgency (D)",
    short: "D",
    descriptions: {
      1: "More than 36 months",
      3: "More than 18 through 36 months",
      6: "More than 6 through 18 months",
      9: "6 months or less / due / overdue",
    },
  },
};

const ALLOWED_VALUES = [1, 3, 6, 9];

function calculateBand(total: number): string {
  if (total <= 80) return "low";
  if (total <= 500) return "moderate";
  if (total <= 2000) return "high";
  return "critical";
}

function getEscalations(factors: Record<string, number | null>): string[] {
  const reasons: string[] = [];
  const a = factors.market_access;
  const d = factors.urgency;
  if (a === 9) reasons.push("Market access = 9 → minimum High");
  if (d === 9) reasons.push("Urgency = 9 → Critical");
  if (a === 9 && d != null && d >= 6) reasons.push("Market access = 9 AND Urgency ≥ 6 → Critical");
  return reasons;
}

function getEffectiveBand(total: number | null, factors: Record<string, number | null>): string {
  if (total == null) return "unscored";
  let band = calculateBand(total);
  const bandOrder: Record<string, number> = { low: 0, moderate: 1, high: 2, critical: 3 };
  if (factors.market_access === 9 && bandOrder[band] < bandOrder.high) band = "high";
  if (factors.urgency === 9) band = "critical";
  if (factors.market_access === 9 && factors.urgency != null && factors.urgency >= 6) band = "critical";
  return band;
}

const BAND_COLORS: Record<string, string> = {
  critical: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700",
  high: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-700",
  moderate: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700",
  low: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/40 dark:text-teal-200 dark:border-teal-700",
  unscored: "bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
};

export function ScoreEditor({
  alertId,
  alertTitle,
  factors: initialFactors,
  liveUrgency,
  onSave,
  onClearOverride,
  onClose,
}: ScoreEditorProps) {
  const [editedValues, setEditedValues] = useState<Record<string, number | null>>({
    market_access: initialFactors.market_access?.effective ?? null,
    cost_to_implement: initialFactors.cost_to_implement?.effective ?? null,
    human_resources: initialFactors.human_resources?.effective ?? null,
    urgency: initialFactors.urgency?.effective ?? null,
  });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewTotal = useMemo(() => {
    const a = editedValues.market_access;
    const b = editedValues.cost_to_implement;
    const c = editedValues.human_resources;
    const d = editedValues.urgency;
    if (a == null || b == null || c == null || d == null) return null;
    return a * b * c * d;
  }, [editedValues]);

  const previewBand = useMemo(
    () => getEffectiveBand(previewTotal, editedValues),
    [previewTotal, editedValues]
  );

  const escalations = useMemo(() => getEscalations(editedValues), [editedValues]);

  const hasChanges = useMemo(() => {
    return Object.keys(FACTOR_LABELS).some((key) => {
      return editedValues[key] !== (initialFactors[key]?.effective ?? null);
    });
  }, [editedValues, initialFactors]);

  const handleSave = async () => {
    const changes: Array<{ target: string; value: number; reason: string }> = [];

    for (const key of Object.keys(FACTOR_LABELS)) {
      if (editedValues[key] !== (initialFactors[key]?.effective ?? null) && editedValues[key] != null) {
        if (!reasons[key]?.trim()) {
          setError(`Reason required for ${FACTOR_LABELS[key].label} change`);
          return;
        }
        changes.push({
          target: key,
          value: editedValues[key]!,
          reason: reasons[key].trim(),
        });
      }
    }

    if (changes.length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(changes);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-3 rounded-t-2xl">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Edit Ratings</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[300px]">{alertTitle}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Preview */}
          <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Preview Total</span>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                {previewTotal ?? "—"}
              </div>
            </div>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold border capitalize ${BAND_COLORS[previewBand]}`}>
              {previewBand === "unscored" && "Unscored"}
              {previewBand !== "unscored" && previewBand}
            </span>
          </div>

          {escalations.length > 0 && (
            <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-2.5 text-xs">
              <div className="flex items-center gap-1 font-semibold text-purple-800 dark:text-purple-200 mb-0.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Escalation
              </div>
              {escalations.map((e, i) => (
                <div key={i} className="text-purple-700 dark:text-purple-300">{e}</div>
              ))}
            </div>
          )}

          {/* Factor Editors */}
          {Object.entries(FACTOR_LABELS).map(([key, meta]) => {
            const factor = initialFactors[key];
            const isUrgency = key === "urgency";
            const changed = editedValues[key] !== (factor?.effective ?? null);

            return (
              <div key={key} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {meta.label}
                  </label>
                  {factor?.override != null && (
                    <button
                      onClick={() => onClearOverride(key)}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <RotateCcw className="h-3 w-3" /> Clear override
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-16">Source: {factor?.source ?? "—"}</span>
                  {isUrgency && liveUrgency != null && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">Live: {liveUrgency}</span>
                  )}
                </div>

                <div className="flex gap-2 mb-2">
                  {ALLOWED_VALUES.map((v) => (
                    <button
                      key={v}
                      onClick={() =>
                        setEditedValues((prev) => ({ ...prev, [key]: v }))
                      }
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                        editedValues[key] === v
                          ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100"
                          : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                      title={meta.descriptions[v]}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                {editedValues[key] != null && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    {meta.descriptions[editedValues[key]!]}
                  </div>
                )}

                {changed && (
                  <input
                    type="text"
                    placeholder="Reason for change (required)"
                    value={reasons[key] || ""}
                    onChange={(e) =>
                      setReasons((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
            );
          })}

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
