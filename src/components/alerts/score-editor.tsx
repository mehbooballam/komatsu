"use client";

import { useEffect, useMemo, useState } from "react";
import { X, AlertTriangle, RotateCcw, Loader2, Lock } from "lucide-react";
import {
  DEFAULT_POLICY, FACTOR_KEYS, FACTOR_LABELS, MAX_TOTAL, RATING_VALUES,
  bandForTotal, factorEscalations, maxBand, normalizePolicy,
  type Band, type ScoringPolicy,
} from "@/lib/scoring/policy";

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
  /** Active total-score override, if any. */
  totalOverride?: number | null;
  onSave: (changes: Array<{ target: string; value: number; reason: string }>) => Promise<void>;
  onClearOverride: (target: string) => Promise<void>;
  onClose: () => void;
}

const BAND_CHIP: Record<Band | "unscored", string> = {
  critical: "bg-violet-100 text-violet-800 ring-violet-300 dark:bg-violet-500/20 dark:text-violet-200 dark:ring-violet-500/40",
  high: "bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-500/20 dark:text-orange-200 dark:ring-orange-500/40",
  moderate: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/40",
  low: "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-500/20 dark:text-teal-200 dark:ring-teal-500/40",
  unscored: "bg-slate-100 text-slate-600 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600",
};

export function ScoreEditor({
  alertTitle,
  factors: initialFactors,
  liveUrgency,
  totalOverride = null,
  onSave,
  onClearOverride,
  onClose,
}: ScoreEditorProps) {
  const [policy, setPolicy] = useState<ScoringPolicy>(DEFAULT_POLICY);
  const [edited, setEdited] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(FACTOR_KEYS.map((k) => [k, initialFactors[k]?.effective ?? null]))
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [useTotal, setUseTotal] = useState(totalOverride != null);
  const [totalValue, setTotalValue] = useState<string>(totalOverride != null ? String(totalOverride) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/scoring/policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPolicy(normalizePolicy(d.policy)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const factorTotal = useMemo(() => {
    const vals = FACTOR_KEYS.map((k) => edited[k]);
    return vals.some((v) => v == null) ? null : (vals as number[]).reduce((a, b) => a * b, 1);
  }, [edited]);

  const totalNum = Number(totalValue);
  const totalValid = Number.isInteger(totalNum) && totalNum >= 1 && totalNum <= MAX_TOTAL;
  const previewTotal = useTotal && policy.total_override_enabled && totalValid ? totalNum : factorTotal;

  const escalations = factorEscalations({ market_access: edited.market_access, urgency: edited.urgency }, policy);
  const previewBand: Band | "unscored" =
    previewTotal == null
      ? "unscored"
      : escalations.reduce<Band | null>((b, e) => maxBand(b, e.resulting_band), bandForTotal(previewTotal, policy)) || "low";

  const changedFactors = FACTOR_KEYS.filter((k) => edited[k] !== (initialFactors[k]?.effective ?? null) && edited[k] != null);
  const totalChanged = useTotal ? totalValid && totalNum !== totalOverride : false;
  const hasChanges = changedFactors.length > 0 || totalChanged;

  const handleSave = async () => {
    const changes: Array<{ target: string; value: number; reason: string }> = [];
    for (const key of changedFactors) {
      if (!reasons[key]?.trim()) {
        setError(`Add a reason for the ${FACTOR_LABELS[key]} change`);
        return;
      }
      changes.push({ target: key, value: edited[key]!, reason: reasons[key].trim() });
    }
    if (useTotal && !totalValid) {
      setError(`Total must be a whole number from 1 to ${MAX_TOTAL.toLocaleString()}`);
      return;
    }
    if (totalChanged) {
      if (!reasons.total?.trim()) {
        setError("Add a reason for overriding the total score");
        return;
      }
      changes.push({ target: "total", value: totalNum, reason: reasons.total.trim() });
    }
    if (!changes.length) {
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

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="score-editor-title" className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h3 id="score-editor-title" className="text-base font-bold text-slate-900 dark:text-white">Adjust score</h3>
            <p className="truncate text-xs text-slate-500">{alertTitle}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Preview */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">New total</span>
              <div className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{previewTotal?.toLocaleString() ?? "—"}</div>
              {useTotal && factorTotal != null && previewTotal !== factorTotal && (
                <div className="text-xs text-slate-500">Calculated A × B × C would be {factorTotal.toLocaleString()}</div>
              )}
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ring-1 ${BAND_CHIP[previewBand]}`}>{previewBand}</span>
          </div>

          {escalations.length > 0 && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs dark:border-violet-500/30 dark:bg-violet-500/10">
              <div className="mb-0.5 flex items-center gap-1 font-semibold text-violet-800 dark:text-violet-200">
                <AlertTriangle className="h-3.5 w-3.5" /> Escalation
              </div>
              {escalations.map((e, i) => (
                <div key={i} className="text-violet-700 dark:text-violet-300">{e.description}</div>
              ))}
            </div>
          )}

          {/* Factors */}
          {FACTOR_KEYS.map((key) => {
            const factor = initialFactors[key];
            const changed = changedFactors.includes(key);
            return (
              <div key={key} className={`rounded-xl border p-4 ${changed ? "border-blue-300 dark:border-blue-500/50" : "border-slate-200 dark:border-slate-700"}`}>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">{FACTOR_LABELS[key]}</label>
                  {factor?.override != null && (
                    <button onClick={() => onClearOverride(key)} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                      <RotateCcw className="h-3 w-3" /> Clear adjustment
                    </button>
                  )}
                </div>
                <div className="mb-2 flex gap-3 text-xs text-slate-500">
                  <span>From source: {factor?.source ?? "—"}</span>
                  {key === "urgency" && liveUrgency != null && <span>Live: {liveUrgency}</span>}
                </div>
                <div className="mb-2 grid grid-cols-4 gap-2">
                  {RATING_VALUES.map((v) => (
                    <button
                      key={v}
                      onClick={() => setEdited((prev) => ({ ...prev, [key]: v }))}
                      title={policy.factors[key].boundaries[String(v)]}
                      className={`rounded-lg border py-2 text-sm font-semibold transition-colors ${
                        edited[key] === v
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                {edited[key] != null && <div className="text-xs text-slate-500">{policy.factors[key].boundaries[String(edited[key])]}</div>}
                {changed && (
                  <input
                    type="text"
                    placeholder="Reason for change (required)"
                    value={reasons[key] || ""}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [key]: e.target.value }))}
                    className={`mt-2 ${inputCls}`}
                  />
                )}
              </div>
            );
          })}

          {/* Total override */}
          <div className={`rounded-xl border p-4 ${useTotal ? "border-blue-300 bg-blue-50/40 dark:border-blue-500/50 dark:bg-blue-500/5" : "border-slate-200 dark:border-slate-700"}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Override total score</p>
                <p className="text-xs text-slate-500">Replace Market access × Cost to implement × Urgency with your own total (1 – {MAX_TOTAL.toLocaleString()})</p>
              </div>
              {policy.total_override_enabled ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={useTotal}
                  aria-label="Override total score"
                  onClick={() => setUseTotal(!useTotal)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${useTotal ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${useTotal ? "left-[22px]" : "left-0.5"}`} />
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Lock className="h-3.5 w-3.5" /> Off in scoring policy</span>
              )}
            </div>
            {useTotal && policy.total_override_enabled && (
              <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr]">
                <input
                  type="number"
                  min={1}
                  max={MAX_TOTAL}
                  value={totalValue}
                  onChange={(e) => setTotalValue(e.target.value)}
                  placeholder={factorTotal != null ? String(factorTotal) : "Total"}
                  className={`${inputCls} tabular-nums`}
                  aria-label="Total score"
                />
                <input
                  type="text"
                  placeholder="Reason for override (required)"
                  value={reasons.total || ""}
                  onChange={(e) => setReasons((prev) => ({ ...prev, total: e.target.value }))}
                  className={inputCls}
                />
              </div>
            )}
            {totalOverride != null && (
              <button onClick={() => onClearOverride("total")} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                <RotateCcw className="h-3 w-3" /> Remove total override ({totalOverride.toLocaleString()})
              </button>
            )}
          </div>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
