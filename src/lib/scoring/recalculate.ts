import { query, getClient, parseDateOnly } from "@/lib/db";
import {
  calculateFullAssessment,
  type SourceRatings,
  type Override,
  type DeadlineInfo,
  type ForecastInfo,
  type ScoringPolicy,
  type AssessmentResult,
} from "./engine";

/**
 * Get the as-of date for scoring: use COMPANY_FROZEN_DATE env if set,
 * otherwise current date in company timezone.
 */
export function getAsOfDate(companyTimeZone: string): Date {
  const frozen = process.env.COMPANY_FROZEN_DATE;
  if (frozen) {
    const [y, m, d] = frozen.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: companyTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const day = Number(parts.find((p) => p.type === "day")!.value);
  return new Date(year, month - 1, day);
}

/** Recalculate a single alert's score and update projection. */
export async function recalculateAlert(
  alertId: string,
  companyId: string,
  asOfDate: Date,
  trigger: string
): Promise<AssessmentResult | null> {
  const alertRes = await query(
    `SELECT a.id, a.current_source_revision_id, a.direct_owner_membership_id, a.primary_group_id,
            c.time_zone, c.active_policy_id
     FROM alerts a JOIN companies c ON c.id = a.company_id
     WHERE a.id = $1 AND a.company_id = $2 AND a.archived_at IS NULL`,
    [alertId, companyId]
  );
  if (alertRes.rows.length === 0) return null;

  const alert = alertRes.rows[0];
  const revisionId = alert.current_source_revision_id;

  const policyRes = await query(
    `SELECT id, version, rules_json FROM scoring_policies WHERE id = $1`,
    [alert.active_policy_id]
  );
  const policy: ScoringPolicy | undefined = policyRes.rows.length > 0
    ? policyRes.rows[0].rules_json
    : undefined;
  const policyVersion = policyRes.rows.length > 0 ? policyRes.rows[0].version : 1;
  const policyId = policyRes.rows.length > 0 ? policyRes.rows[0].id : null;

  let sourceRatings: SourceRatings = {
    market_access: null,
    cost_to_implement: null,
    human_resources: null,
    urgency: null,
  };

  if (revisionId) {
    const ratingsRes = await query(
      `SELECT factor_key, parsed_value FROM source_factor_ratings
       WHERE alert_source_revision_id = $1 AND company_id = $2`,
      [revisionId, companyId]
    );
    for (const row of ratingsRes.rows) {
      if (row.factor_key in sourceRatings) {
        (sourceRatings as unknown as Record<string, number | null>)[row.factor_key] = row.parsed_value;
      }
    }
  }

  const overridesRes = await query(
    `SELECT target, value, expires_at, ended_at FROM score_overrides
     WHERE alert_id = $1 AND company_id = $2 AND ended_at IS NULL`,
    [alertId, companyId]
  );
  const overrides: Override[] = overridesRes.rows.map((r) => ({
    target: r.target,
    value: r.value,
    expires_at: r.expires_at ? new Date(r.expires_at) : null,
    ended_at: r.ended_at ? new Date(r.ended_at) : null,
  }));

  // Prefer a verified compliance deadline; otherwise fall back to the earliest
  // outstanding, not-rejected deadline (e.g. the date supplied in the import file)
  // so the deadline is still shown and can inform urgency.
  const deadlineRes = await query(
    `SELECT id, date_value, kind, verification_state, lifecycle_state, applies_to
     FROM alert_deadlines
     WHERE alert_id = $1 AND company_id = $2
       AND lifecycle_state = 'outstanding'
       AND verification_state NOT IN ('rejected', 'superseded')
       AND kind <> 'comment'
     ORDER BY (kind = 'compliance' AND verification_state = 'verified') DESC, date_value ASC
     LIMIT 1`,
    [alertId, companyId]
  );
  let deadline: DeadlineInfo | null = null;
  let selectedDeadlineId: string | null = null;
  if (deadlineRes.rows.length > 0) {
    const dl = deadlineRes.rows[0];
    deadline = {
      date_value: parseDateOnly(dl.date_value),
      kind: dl.kind,
      verification_state: dl.verification_state,
      lifecycle_state: dl.lifecycle_state,
    };
    selectedDeadlineId = dl.id;
  }

  const forecastRes = await query(
    `SELECT id, remaining_days, estimated_finish_date, as_of_date
     FROM implementation_forecasts
     WHERE alert_id = $1 AND company_id = $2 AND status = 'current'
     ORDER BY created_at DESC LIMIT 1`,
    [alertId, companyId]
  );
  let forecast: ForecastInfo | null = null;
  let forecastId: string | null = null;
  if (forecastRes.rows.length > 0) {
    const fc = forecastRes.rows[0];
    forecast = {
      remaining_days: fc.remaining_days,
      estimated_finish_date: fc.estimated_finish_date ? parseDateOnly(fc.estimated_finish_date) : null,
      as_of_date: parseDateOnly(fc.as_of_date),
    };
    forecastId = fc.id;
  }

  const assessment = calculateFullAssessment({
    sourceRatings,
    overrides,
    deadline,
    forecast,
    asOfDate,
    policyVersion,
    policy,
  });

  const existingRes = await query(
    `SELECT input_signature FROM score_assessments
     WHERE alert_id = $1 AND company_id = $2 AND is_latest = TRUE
     ORDER BY calculated_at DESC LIMIT 1`,
    [alertId, companyId]
  );

  const signatureChanged =
    existingRes.rows.length === 0 ||
    existingRes.rows[0].input_signature !== assessment.input_signature;

  if (signatureChanged) {
    await query(
      `UPDATE score_assessments SET is_latest = FALSE
       WHERE alert_id = $1 AND company_id = $2 AND is_latest = TRUE`,
      [alertId, companyId]
    );

    const insertRes = await query(
      `INSERT INTO score_assessments (
        company_id, alert_id, policy_id, source_revision_id, selected_deadline_id, forecast_id,
        as_of_date, days_remaining, margin_days,
        factor_market_access, factor_cost_to_implement, factor_human_resources, factor_urgency,
        effective_market_access, effective_cost_to_implement, effective_human_resources, effective_urgency,
        raw_total, raw_band, effective_total, base_band, effective_band,
        escalation_reasons, review_flags, input_signature, calculation_trigger, is_latest
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23, $24, $25, $26, TRUE
      ) RETURNING id`,
      [
        companyId, alertId, policyId, revisionId, selectedDeadlineId, forecastId,
        assessment.as_of_date.toISOString().split("T")[0],
        assessment.days_remaining, assessment.margin_days,
        assessment.factor_market_access, assessment.factor_cost_to_implement,
        assessment.factor_human_resources, assessment.factor_urgency,
        assessment.effective_market_access, assessment.effective_cost_to_implement,
        assessment.effective_human_resources, assessment.effective_urgency,
        assessment.raw_total, assessment.raw_band, assessment.effective_total,
        assessment.base_band, assessment.effective_band,
        JSON.stringify(assessment.escalation_reasons), JSON.stringify(assessment.review_flags),
        assessment.input_signature, trigger,
      ]
    );

    const assessmentId = insertRes.rows[0].id;
    await updateProjection(alertId, companyId, assessmentId);
  }

  return assessment;
}

/** Update alert_active_projections with the latest assessment data. */
export async function updateProjection(
  alertId: string,
  companyId: string,
  assessmentId: string
): Promise<void> {
  const assessRes = await query(
    `SELECT effective_band, effective_total, days_remaining, as_of_date, selected_deadline_id
     FROM score_assessments WHERE id = $1`,
    [assessmentId]
  );
  if (assessRes.rows.length === 0) return;

  const assess = assessRes.rows[0];

  let nextDeadline: string | null = null;
  if (assess.selected_deadline_id) {
    const dlRes = await query(
      `SELECT date_value FROM alert_deadlines WHERE id = $1`,
      [assess.selected_deadline_id]
    );
    if (dlRes.rows.length > 0) {
      nextDeadline = dlRes.rows[0].date_value;
    }
  }

  const alertRes = await query(
    `SELECT direct_owner_membership_id, primary_group_id FROM alerts WHERE id = $1`,
    [alertId]
  );
  let effectiveOwnerId: string | null = null;
  if (alertRes.rows.length > 0) {
    const a = alertRes.rows[0];
    effectiveOwnerId = a.direct_owner_membership_id;
    if (!effectiveOwnerId && a.primary_group_id) {
      const grpRes = await query(
        `SELECT owner_membership_id FROM regulation_groups WHERE id = $1`,
        [a.primary_group_id]
      );
      if (grpRes.rows.length > 0) {
        effectiveOwnerId = grpRes.rows[0].owner_membership_id;
      }
    }
  }

  const priority = assess.effective_band ?? (assess.effective_total === null ? "unscored" : assess.effective_band);

  await query(
    `INSERT INTO alert_active_projections (
      company_id, alert_id, latest_assessment_id, next_compliance_deadline,
      days_remaining, effective_priority, effective_total, effective_owner_id,
      is_active, version, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, 1, NOW())
    ON CONFLICT (company_id, alert_id) DO UPDATE SET
      latest_assessment_id = EXCLUDED.latest_assessment_id,
      next_compliance_deadline = EXCLUDED.next_compliance_deadline,
      days_remaining = EXCLUDED.days_remaining,
      effective_priority = EXCLUDED.effective_priority,
      effective_total = EXCLUDED.effective_total,
      effective_owner_id = EXCLUDED.effective_owner_id,
      version = alert_active_projections.version + 1,
      updated_at = NOW()`,
    [
      companyId, alertId, assessmentId, nextDeadline,
      assess.days_remaining, priority, assess.effective_total, effectiveOwnerId,
    ]
  );
}

/** Recalculate all active alerts for a company. */
export async function recalculateCompanyAlerts(
  companyId: string,
  asOfDate: Date,
  trigger: string
): Promise<{ recalculated: number; changed: number }> {
  const alertsRes = await query(
    `SELECT id FROM alerts WHERE company_id = $1 AND archived_at IS NULL`,
    [companyId]
  );

  let recalculated = 0;
  let changed = 0;

  for (const row of alertsRes.rows) {
    const result = await recalculateAlert(row.id, companyId, asOfDate, trigger);
    recalculated++;
    if (result) changed++;
  }

  return { recalculated, changed };
}
