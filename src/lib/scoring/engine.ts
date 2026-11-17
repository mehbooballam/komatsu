import { addMonths, differenceInCalendarDays, endOfMonth, isAfter, isBefore, isEqual, startOfDay } from "date-fns";

import {
  bandForTotal,
  factorEscalations,
  normalizePolicy,
  escalationText,
  MAX_TOTAL,
  type Band,
  type FactorKey,
  type ScoringPolicy,
} from "./policy";

export type { Band, FactorKey, ScoringPolicy };
export const VALID_RATINGS = [1, 3, 6, 9] as const;
export type Rating = (typeof VALID_RATINGS)[number];

export interface FactorValues {
  market_access: number | null;
  cost_to_implement: number | null;
  human_resources: number | null;
  urgency: number | null;
}

export interface EscalationResult {
  reasons: Array<{ condition: string; description: string; resulting_band: Band }>;
  effective_band: Band | null;
}

export interface DeadlineInfo {
  date_value: Date;
  kind: string;
  verification_state: string;
  lifecycle_state: string;
}

export interface ForecastInfo {
  remaining_days: number | null;
  estimated_finish_date: Date | null;
  as_of_date: Date;
}

export interface UrgencyResult {
  rating: number;
  days_remaining: number | null;
  low_confidence: boolean;
  label: string;
}

export interface AssessmentResult {
  as_of_date: Date;
  days_remaining: number | null;
  margin_days: number | null;
  factor_market_access: number | null;
  factor_cost_to_implement: number | null;
  factor_human_resources: number | null;
  factor_urgency: number | null;
  effective_market_access: number | null;
  effective_cost_to_implement: number | null;
  effective_human_resources: number | null;
  effective_urgency: number | null;
  raw_total: number | null;
  raw_band: string | null;
  effective_total: number | null;
  base_band: string | null;
  effective_band: string | null;
  escalation_reasons: Array<{ condition: string; description: string; resulting_band: Band }>;
  review_flags: string[];
  input_signature: string;
  is_unscored: boolean;
}

const BAND_ORDER: Band[] = ["low", "moderate", "high", "critical"];

function bandRank(band: Band): number {
  return BAND_ORDER.indexOf(band);
}

function maxBand(a: Band | null, b: Band | null): Band {
  if (!a) return b ?? "low";
  if (!b) return a;
  return bandRank(a) >= bandRank(b) ? a : b;
}

/** Map a raw numeric total to its base band, using the policy's band thresholds. */
export function calculateBand(total: number, policy?: ScoringPolicy): Band {
  return bandForTotal(total, normalizePolicy(policy));
}

/**
 * Compute the number of calendar days remaining from asOfDate to deadlineDate.
 * Positive means deadline is in the future; negative means overdue.
 */
export function computeDaysRemaining(deadlineDate: Date, asOfDate: Date): number {
  return differenceInCalendarDays(startOfDay(deadlineDate), startOfDay(asOfDate));
}

/** Compute schedule margin = days remaining − remaining implementation days. */
export function computeScheduleMargin(daysRemaining: number, remainingImplDays: number): number {
  return daysRemaining - remainingImplDays;
}

/**
 * Calculate urgency rating from a confirmed compliance deadline date.
 *
 * Uses calendar-month cutoffs with end-of-month clamping:
 *   >36 months → 1, >18–36 → 3, >6–18 → 6, ≤6 months/due/overdue → 9.
 *
 * The default policy assigns exactly 6 months to rating 9.
 */
export function computeUrgencyFromDeadline(
  deadlineDate: Date,
  asOfDate: Date,
  policy?: ScoringPolicy
): UrgencyResult {
  const daysRemaining = computeDaysRemaining(deadlineDate, asOfDate);

  const cutoff6 = clampedAddMonths(asOfDate, 6);
  const cutoff18 = clampedAddMonths(asOfDate, 18);
  const cutoff36 = clampedAddMonths(asOfDate, 36);

  const dl = startOfDay(deadlineDate);
  const exactly6MonthsRating = policy?.factors?.urgency?.boundary_values?.exactly_6_months ?? 9;

  let rating: number;
  let label: string;

  if (isEqual(dl, cutoff6)) {
    rating = exactly6MonthsRating;
    label = `Exactly 6 months (${daysRemaining} days)`;
  } else if (isBefore(dl, cutoff6) || isEqual(dl, startOfDay(asOfDate))) {
    rating = 9;
    if (daysRemaining < 0) {
      label = `Overdue by ${Math.abs(daysRemaining)} days`;
    } else if (daysRemaining === 0) {
      label = "Due today";
    } else {
      label = `${daysRemaining} days remaining (≤6 months)`;
    }
  } else if (isBefore(dl, cutoff18) || isEqual(dl, cutoff18)) {
    rating = 6;
    label = `${daysRemaining} days remaining (6–18 months)`;
  } else if (isBefore(dl, cutoff36) || isEqual(dl, cutoff36)) {
    rating = 3;
    label = `${daysRemaining} days remaining (18–36 months)`;
  } else {
    rating = 1;
    label = `${daysRemaining} days remaining (>36 months)`;
  }

  return { rating, days_remaining: daysRemaining, low_confidence: false, label };
}

/**
 * Add months to a date with end-of-month clamping.
 * e.g. Aug 31 + 6 months = Feb 28 (not Mar 3).
 */
function clampedAddMonths(date: Date, months: number): Date {
  const result = addMonths(startOfDay(date), months);
  const expectedMonth = (date.getMonth() + months) % 12;
  if (result.getMonth() !== expectedMonth) {
    return startOfDay(endOfMonth(addMonths(startOfDay(date), months - 1)));
  }
  return startOfDay(result);
}

/**
 * Determine escalation rules that apply and compute the effective band.
 * Applies the strongest qualifying escalation after computing the base band.
 */
export function calculateEscalation(
  factors: FactorValues,
  baseBand: Band | null,
  deadline?: DeadlineInfo | null,
  forecast?: ForecastInfo | null,
  asOfDate?: Date,
  rawPolicy?: ScoringPolicy
): EscalationResult {
  const policy = normalizePolicy(rawPolicy);
  const reasons: EscalationResult["reasons"] = [];
  let effectiveBand: Band | null = baseBand;

  // Rules 1 & 2: factor-based escalations (thresholds, bands and on/off come from the policy)
  for (const r of factorEscalations(factors, policy)) {
    reasons.push(r);
    effectiveBand = maxBand(effectiveBand, r.resulting_band);
  }

  const deadlineRule = policy.escalations.find((e) => e.condition === "forecast_missed_deadline");
  const deadlineRuleOn = !!deadlineRule?.enabled;
  const deadlineBand: Band = deadlineRule?.band ?? "critical";
  const deadlineText = deadlineRule ? escalationText(deadlineRule) : "";

  // Rule 3: Forecast missed compliance deadline
  if (deadlineRuleOn && deadline && forecast && asOfDate) {
    const deadlineMs = startOfDay(deadline.date_value).getTime();
    let missed = false;

    if (forecast.estimated_finish_date) {
      const finishMs = startOfDay(forecast.estimated_finish_date).getTime();
      if (finishMs > deadlineMs) {
        missed = true;
      }
    } else if (forecast.remaining_days !== null) {
      const daysRemaining = computeDaysRemaining(deadline.date_value, asOfDate);
      const margin = computeScheduleMargin(daysRemaining, forecast.remaining_days);
      if (margin < 0) {
        missed = true;
      }
    }

    if (missed) {
      reasons.push({
        condition: "forecast_missed_deadline",
        description: `Forecast misses the compliance deadline (${deadlineText})`,
        resulting_band: deadlineBand,
      });
      effectiveBand = maxBand(effectiveBand, deadlineBand);
    }
  }

  // Rule 3 also: confirmed overdue outstanding obligation
  if (deadlineRuleOn && deadline && asOfDate) {
    const daysRemaining = computeDaysRemaining(deadline.date_value, asOfDate);
    if (
      daysRemaining < 0 &&
      deadline.lifecycle_state === "outstanding" &&
      deadline.verification_state === "verified" &&
      deadline.kind === "compliance"
    ) {
      const alreadyHasForecastMiss = reasons.some((r) => r.condition === "forecast_missed_deadline");
      if (!alreadyHasForecastMiss) {
        reasons.push({
          condition: "forecast_missed_deadline",
          description: `Confirmed compliance deadline is overdue (${deadlineText})`,
          resulting_band: deadlineBand,
        });
        effectiveBand = maxBand(effectiveBand, deadlineBand);
      }
    }
  }

  return { reasons, effective_band: effectiveBand };
}

export interface SourceRatings {
  market_access: number | null;
  cost_to_implement: number | null;
  human_resources: number | null;
  urgency: number | null;
}

export interface Override {
  target: string;
  value: number;
  expires_at: Date | null;
  ended_at: Date | null;
}

/**
 * Resolve the effective factor values from source ratings, overrides, and deadline.
 *
 * For A, B, C: active local override first, then valid source rating.
 * For D: live deadline-derived urgency by default; manual override if active.
 */
export function resolveEffectiveFactors(
  sourceRatings: SourceRatings,
  overrides: Override[],
  deadline: DeadlineInfo | null,
  asOfDate: Date,
  policy?: ScoringPolicy
): {
  factors: FactorValues;
  urgencyResult: UrgencyResult;
  effectiveFactors: FactorValues;
} {
  const now = new Date();

  function activeOverride(target: string): Override | null {
    return (
      overrides.find(
        (o) =>
          o.target === target &&
          o.ended_at === null &&
          (o.expires_at === null || isAfter(o.expires_at, now))
      ) ?? null
    );
  }

  const sourceA = sourceRatings.market_access;
  const sourceB = sourceRatings.cost_to_implement;

  const overrideA = activeOverride("market_access");
  const overrideB = activeOverride("cost_to_implement");
  const overrideD = activeOverride("urgency");

  const effectiveA = overrideA ? overrideA.value : sourceA;
  const effectiveB = overrideB ? overrideB.value : sourceB;
  // "Additional people" is no longer part of the score (kept only in import history).
  const effectiveC = null;

  let urgencyResult: UrgencyResult;

  if (deadline && deadline.kind === "compliance" && deadline.verification_state === "verified" && deadline.lifecycle_state === "outstanding") {
    urgencyResult = computeUrgencyFromDeadline(deadline.date_value, asOfDate, policy);
  } else if (sourceRatings.urgency !== null && sourceRatings.urgency !== undefined) {
    // No confirmed deadline yet: use the urgency rating supplied in the import file.
    urgencyResult = {
      rating: sourceRatings.urgency,
      days_remaining: deadline && deadline.lifecycle_state === "outstanding" ? computeDaysRemaining(deadline.date_value, asOfDate) : null,
      low_confidence: true,
      label: "Urgency from imported rating (deadline not yet confirmed)",
    };
  } else if (deadline && deadline.lifecycle_state === "outstanding") {
    // Unconfirmed deadline date from the import: derive urgency, flagged as low confidence.
    urgencyResult = { ...computeUrgencyFromDeadline(deadline.date_value, asOfDate, policy), low_confidence: true };
  } else {
    urgencyResult = {
      rating: 1,
      days_remaining: null,
      low_confidence: true,
      label: "No confirmed compliance deadline",
    };
  }

  const liveD = urgencyResult.rating;
  const effectiveD = overrideD ? overrideD.value : liveD;

  return {
    factors: {
      market_access: sourceA,
      cost_to_implement: sourceB,
      human_resources: null,
      urgency: liveD,
    },
    urgencyResult,
    effectiveFactors: {
      market_access: effectiveA,
      cost_to_implement: effectiveB,
      human_resources: effectiveC,
      urgency: effectiveD,
    },
  };
}

/**
 * Calculate the full score assessment for an alert.
 *
 * Returns all fields needed for the score_assessments table, including
 * raw total, base band, effective band after escalation, and review flags.
 */
export function calculateFullAssessment(params: {
  sourceRatings: SourceRatings;
  overrides: Override[];
  deadline: DeadlineInfo | null;
  forecast: ForecastInfo | null;
  asOfDate: Date;
  policyVersion: number;
  policy?: ScoringPolicy;
}): AssessmentResult {
  const { sourceRatings, overrides, deadline, forecast, asOfDate, policyVersion } = params;
  const policy = normalizePolicy(params.policy);

  const { factors, urgencyResult, effectiveFactors } = resolveEffectiveFactors(
    sourceRatings,
    overrides,
    deadline,
    asOfDate,
    policy
  );

  const eA = effectiveFactors.market_access;
  const eB = effectiveFactors.cost_to_implement;
  const eD = effectiveFactors.urgency;

  const allSourceBlank =
    sourceRatings.market_access === null &&
    sourceRatings.cost_to_implement === null;

  const hasOverridesForABC =
    overrides.some(
      (o) =>
        ["market_access", "cost_to_implement"].includes(o.target) &&
        o.ended_at === null &&
        (o.expires_at === null || isAfter(o.expires_at, new Date()))
    );

  // Direct override of the total score (only when the policy allows it)
  const totalOverride = policy.total_override_enabled
    ? overrides.find(
        (o) => o.target === "total" && o.ended_at === null && (o.expires_at === null || isAfter(o.expires_at, new Date()))
      ) ?? null
    : null;

  const isUnscored = allSourceBlank && !hasOverridesForABC && !totalOverride;

  const allFactorsPresent = eA !== null && eB !== null && eD !== null;

  let rawTotal: number | null = null;
  let rawBand: Band | null = null;
  let effectiveTotal: number | null = null;
  let baseBand: Band | null = null;

  if (allFactorsPresent && !(allSourceBlank && !hasOverridesForABC)) {
    // Total = Market access × Cost to implement × Urgency (1–729)
    rawTotal = eA! * eB! * eD!;
    rawBand = calculateBand(rawTotal, policy);
    effectiveTotal = rawTotal;
    baseBand = rawBand;
  }

  if (totalOverride) {
    effectiveTotal = Math.min(MAX_TOTAL, Math.max(1, Math.round(totalOverride.value)));
    baseBand = calculateBand(effectiveTotal, policy);
  }

  const escalation = calculateEscalation(effectiveFactors, baseBand, deadline, forecast, asOfDate, policy);

  let effectiveBand: Band | null = escalation.effective_band;

  if (isUnscored) {
    effectiveBand = null;
    if (escalation.reasons.length > 0) {
      effectiveBand = escalation.effective_band;
    }
  }

  const reviewFlags: string[] = [];

  if (urgencyResult.low_confidence) {
    reviewFlags.push("low_confidence_deadline");
  }

  if (eA !== null && eA >= 6 && eB !== null && eB >= 6 && !deadline) {
    reviewFlags.push("draft_undated_high_market_access_high_cost");
  }

  const daysRemaining = urgencyResult.days_remaining;
  let marginDays: number | null = null;
  if (daysRemaining !== null && forecast?.remaining_days !== null && forecast?.remaining_days !== undefined) {
    marginDays = computeScheduleMargin(daysRemaining, forecast.remaining_days);
  }

  const signatureInputs = {
    eA, eB, eD,
    formula: "A*B*D",
    deadline: deadline?.date_value?.toISOString() ?? null,
    deadlineKind: deadline?.kind ?? null,
    deadlineVerification: deadline?.verification_state ?? null,
    forecastRemainingDays: forecast?.remaining_days ?? null,
    forecastFinish: forecast?.estimated_finish_date?.toISOString() ?? null,
    policyVersion,
    policyHash: hashObject(policy as unknown as Record<string, unknown>),
    totalOverride: totalOverride?.value ?? null,
    asOfDate: asOfDate.toISOString().split("T")[0],
  };
  const input_signature = hashObject(signatureInputs);

  return {
    as_of_date: asOfDate,
    days_remaining: daysRemaining,
    margin_days: marginDays,
    factor_market_access: factors.market_access,
    factor_cost_to_implement: factors.cost_to_implement,
    factor_human_resources: factors.human_resources,
    factor_urgency: factors.urgency,
    effective_market_access: effectiveFactors.market_access,
    effective_cost_to_implement: effectiveFactors.cost_to_implement,
    effective_human_resources: effectiveFactors.human_resources,
    effective_urgency: effectiveFactors.urgency,
    raw_total: rawTotal,
    raw_band: rawBand,
    effective_total: effectiveTotal,
    base_band: baseBand,
    effective_band: effectiveBand,
    escalation_reasons: escalation.reasons,
    review_flags: reviewFlags,
    input_signature,
    is_unscored: isUnscored,
  };
}

function hashObject(obj: Record<string, unknown>): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 32);
}
