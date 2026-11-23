/**
 * Scoring policy: shape, defaults, validation and the pure band/escalation rules.
 * No server-only imports, so the editor UI can use the same logic as the engine.
 */

export type Band = "low" | "moderate" | "high" | "critical";
/** Scoring factors. Total = Market access × Cost to implement × Urgency (1–729).
 *  "Additional people" (human_resources) is no longer scored; imported values are kept only as history. */
export type FactorKey = "market_access" | "cost_to_implement" | "urgency";

export const BANDS: Band[] = ["low", "moderate", "high", "critical"];
export const FACTOR_KEYS: FactorKey[] = ["market_access", "cost_to_implement", "urgency"];
export const RATING_VALUES = [1, 3, 6, 9] as const;
export const MAX_TOTAL = 9 * 9 * 9; // 729
export const FORMULA_TEXT = "Market access × Cost to implement × Urgency";

export const FACTOR_LABELS: Record<FactorKey, string> = {
  market_access: "Market access (A)",
  cost_to_implement: "Cost to implement (B)",
  urgency: "Urgency (C)",
};

export type EscalationCondition = "market_access_9" | "urgency_9_and_market_access_gte_6" | "forecast_missed_deadline";

export interface EscalationRule {
  condition: EscalationCondition;
  enabled: boolean;
  /** Band the alert is raised to (at least). */
  band: Band;
  description: string;
  /** Rule parameters (only the ones that apply to the condition are used). */
  params?: { market_access?: number; urgency?: number };
}

export interface ScoringPolicy {
  factors: Record<FactorKey, { allowed_values: number[]; boundaries: Record<string, string>; boundary_values?: Record<string, number> }>;
  /** Inclusive [min, max] totals per band. */
  bands: Record<Band, [number, number]>;
  escalations: EscalationRule[];
  /** When true, reviewers may override an alert's total score directly. */
  total_override_enabled: boolean;
  version: number;
}

export const DEFAULT_POLICY: ScoringPolicy = {
  factors: {
    market_access: {
      allowed_values: [1, 3, 6, 9],
      boundaries: {
        "1": "USD 0 to under 100,000",
        "3": "USD 100,000 to 1,000,000",
        "6": "Over USD 1,000,000 through 5,000,000",
        "9": "Over USD 5,000,000",
      },
    },
    cost_to_implement: {
      allowed_values: [1, 3, 6, 9],
      boundaries: {
        "1": "USD 0 to under 25,000",
        "3": "USD 25,000 to 250,000",
        "6": "Over USD 250,000 through 1,000,000",
        "9": "Over USD 1,000,000",
      },
    },
    urgency: {
      allowed_values: [1, 3, 6, 9],
      boundaries: {
        "1": "More than 36 months",
        "3": "More than 18 through 36 months",
        "6": "More than 6 through 18 months",
        "9": "6 months or less, due today, or overdue",
      },
      boundary_values: { exactly_6_months: 9 },
    },
  },
  bands: {
    low: [1, 26], // 3×3×3 = 27 starts Moderate
    moderate: [27, 107], // 6×6×3 = 108 starts High
    high: [108, 242], // 9×9×3 = 243 starts Critical
    critical: [243, MAX_TOTAL],
  },
  escalations: [
    {
      condition: "market_access_9",
      enabled: true,
      band: "high",
      params: { market_access: 9 },
      description: "Market access at or above the threshold gives at least this priority",
    },
    {
      condition: "urgency_9_and_market_access_gte_6",
      enabled: true,
      band: "critical",
      params: { urgency: 9, market_access: 6 },
      description: "High urgency combined with significant market access gives this priority",
    },
    {
      condition: "forecast_missed_deadline",
      enabled: true,
      band: "critical",
      description: "Forecast to miss (or already past) a confirmed compliance deadline gives this priority",
    },
  ],
  total_override_enabled: true,
  version: 1,
};

function isBand(v: unknown): v is Band {
  return typeof v === "string" && (BANDS as string[]).includes(v);
}

/** Fill gaps in a stored policy (older versions lack enabled/params) with defaults. */
export function normalizePolicy(raw: unknown): ScoringPolicy {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<ScoringPolicy> & {
    escalations?: Array<Record<string, unknown>>;
  };

  const factors = { ...DEFAULT_POLICY.factors };
  for (const key of FACTOR_KEYS) {
    const f = p.factors?.[key];
    if (f) {
      factors[key] = {
        allowed_values: [1, 3, 6, 9],
        boundaries: { ...DEFAULT_POLICY.factors[key].boundaries, ...(f.boundaries || {}) },
        boundary_values: { ...(DEFAULT_POLICY.factors[key].boundary_values || {}), ...(f.boundary_values || {}) },
      };
    }
  }

  const bands = { ...DEFAULT_POLICY.bands };
  for (const b of BANDS) {
    const v = p.bands?.[b];
    if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n)))) {
      bands[b] = [Number(v[0]), Number(v[1])];
    }
  }

  const escalations = DEFAULT_POLICY.escalations.map((def) => {
    const stored = ((p.escalations || []) as Array<Record<string, unknown>>).find((e) => e.condition === def.condition);
    if (!stored) return { ...def, params: { ...def.params } };
    const band = isBand(stored.band) ? stored.band : isBand(stored.minimum_band) ? stored.minimum_band : def.band;
    const params = { ...def.params, ...((stored.params as EscalationRule["params"]) || {}) };
    return {
      ...def,
      enabled: stored.enabled === undefined ? true : !!stored.enabled,
      band,
      params,
    };
  });

  return {
    factors,
    bands,
    escalations,
    total_override_enabled: p.total_override_enabled === undefined ? true : !!p.total_override_enabled,
    version: typeof p.version === "number" ? p.version : 1,
  };
}

/** Returns a list of problems; empty means the policy is valid. */
export function validatePolicy(p: ScoringPolicy): string[] {
  const errors: string[] = [];
  const [lMin, lMax] = p.bands.low;
  const [mMin, mMax] = p.bands.moderate;
  const [hMin, hMax] = p.bands.high;
  const [cMin, cMax] = p.bands.critical;
  const ints = [lMin, lMax, mMin, mMax, hMin, hMax, cMin, cMax];
  if (ints.some((n) => !Number.isInteger(n))) errors.push("Band limits must be whole numbers.");
  if (lMin !== 1) errors.push("Low must start at 1.");
  if (cMax !== MAX_TOTAL) errors.push(`Critical must end at ${MAX_TOTAL}.`);
  if (!(lMax >= lMin && mMin === lMax + 1 && mMax >= mMin && hMin === mMax + 1 && hMax >= hMin && cMin === hMax + 1 && cMax >= cMin)) {
    errors.push("Bands must be in order (Low < Moderate < High < Critical) with no gaps or overlaps.");
  }
  for (const key of FACTOR_KEYS) {
    for (const v of RATING_VALUES) {
      const label = p.factors[key]?.boundaries?.[String(v)];
      if (!label || !label.trim()) errors.push(`${FACTOR_LABELS[key]}: description for rating ${v} is required.`);
      else if (label.length > 200) errors.push(`${FACTOR_LABELS[key]}: description for rating ${v} is too long.`);
    }
  }
  for (const e of p.escalations) {
    if (!isBand(e.band)) errors.push(`Escalation "${e.condition}" has an invalid band.`);
    for (const v of Object.values(e.params || {})) {
      if (v !== undefined && !(RATING_VALUES as readonly number[]).includes(v)) errors.push(`Escalation thresholds must be 1, 3, 6 or 9.`);
    }
  }
  return errors;
}

/** Map a total to its band using the policy's thresholds. */
export function bandForTotal(total: number, policy: ScoringPolicy = DEFAULT_POLICY): Band {
  for (const b of [...BANDS].reverse()) {
    if (total >= policy.bands[b][0]) return b;
  }
  return "low";
}

export function bandRank(b: Band) {
  return BANDS.indexOf(b);
}

export function maxBand(a: Band | null, b: Band | null): Band | null {
  if (!a) return b;
  if (!b) return a;
  return bandRank(a) >= bandRank(b) ? a : b;
}

export function escalationText(rule: EscalationRule): string {
  const band = rule.band.charAt(0).toUpperCase() + rule.band.slice(1);
  switch (rule.condition) {
    case "market_access_9":
      return `Market access ≥ ${rule.params?.market_access ?? 9} → at least ${band}`;
    case "urgency_9_and_market_access_gte_6":
      return `Urgency ≥ ${rule.params?.urgency ?? 9} and market access ≥ ${rule.params?.market_access ?? 6} → ${band}`;
    case "forecast_missed_deadline":
      return `Missed or overdue confirmed compliance deadline → ${band}`;
  }
}

/** Factor-based escalations (the deadline/forecast rule is applied by the engine). */
export function factorEscalations(
  factors: { market_access: number | null; urgency: number | null },
  policy: ScoringPolicy = DEFAULT_POLICY
): Array<{ condition: EscalationCondition; description: string; resulting_band: Band }> {
  const out: Array<{ condition: EscalationCondition; description: string; resulting_band: Band }> = [];
  for (const rule of policy.escalations) {
    if (!rule.enabled) continue;
    if (rule.condition === "market_access_9") {
      const t = rule.params?.market_access ?? 9;
      if (factors.market_access !== null && factors.market_access >= t) {
        out.push({ condition: rule.condition, description: escalationText(rule), resulting_band: rule.band });
      }
    } else if (rule.condition === "urgency_9_and_market_access_gte_6") {
      const u = rule.params?.urgency ?? 9;
      const m = rule.params?.market_access ?? 6;
      if (factors.urgency !== null && factors.urgency >= u && factors.market_access !== null && factors.market_access >= m) {
        out.push({ condition: rule.condition, description: escalationText(rule), resulting_band: rule.band });
      }
    }
  }
  return out;
}
