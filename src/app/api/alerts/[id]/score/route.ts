import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { recalculateAlert, getAsOfDate } from "@/lib/scoring/recalculate";
import { VALID_RATINGS } from "@/lib/scoring/engine";
import { normalizePolicy, MAX_TOTAL } from "@/lib/scoring/policy";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(_request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await query(
    `SELECT sa.*, ad.date_value AS deadline_date, ad.kind AS deadline_kind
     FROM score_assessments sa
     LEFT JOIN alert_deadlines ad ON ad.id = sa.selected_deadline_id
     WHERE sa.alert_id = $1 AND sa.company_id = $2 AND sa.is_latest = TRUE
     LIMIT 1`,
    [id, session.membership.company_id]
  );

  if (res.rows.length === 0) {
    return NextResponse.json({ error: "No assessment found" }, { status: 404 });
  }

  const overrides = await query(
    `SELECT target, value, reason, expires_at, created_at FROM score_overrides
     WHERE alert_id = $1 AND company_id = $2 AND ended_at IS NULL
     ORDER BY created_at DESC`,
    [id, session.membership.company_id]
  );

  return NextResponse.json({
    assessment: res.rows[0],
    active_overrides: overrides.rows,
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["company_admin", "manager", "reviewer"].includes(session.membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { target, value, reason, expires_at } = body;

  if (!target || !value || !reason) {
    return NextResponse.json({ error: "target, value, and reason are required" }, { status: 400 });
  }

  const validTargets = ["market_access", "cost_to_implement", "urgency", "total"];
  if (!validTargets.includes(target)) {
    return NextResponse.json({ error: `Invalid target. Must be one of: ${validTargets.join(", ")}` }, { status: 400 });
  }

  if (target === "total") {
    const policyRes = await query(
      `SELECT sp.rules_json FROM companies c JOIN scoring_policies sp ON sp.id = c.active_policy_id WHERE c.id = $1`,
      [session.membership.company_id]
    );
    if (!normalizePolicy(policyRes.rows[0]?.rules_json).total_override_enabled) {
      return NextResponse.json({ error: "Total score overrides are turned off in the scoring policy" }, { status: 400 });
    }
    if (!Number.isInteger(value) || value < 1 || value > MAX_TOTAL) {
      return NextResponse.json({ error: `Total must be a whole number from 1 to ${MAX_TOTAL}` }, { status: 400 });
    }
  } else if (!VALID_RATINGS.includes(value as 1 | 3 | 6 | 9)) {
    return NextResponse.json({ error: "Value must be 1, 3, 6, or 9" }, { status: 400 });
  }

  const alertRes = await query(
    `SELECT id, record_version FROM alerts WHERE id = $1 AND company_id = $2`,
    [id, session.membership.company_id]
  );
  if (alertRes.rows.length === 0) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  await query(
    `UPDATE score_overrides SET ended_at = NOW()
     WHERE alert_id = $1 AND company_id = $2 AND target = $3 AND ended_at IS NULL`,
    [id, session.membership.company_id, target]
  );

  await query(
    `INSERT INTO score_overrides (company_id, alert_id, target, value, reason, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [session.membership.company_id, id, target, value, reason, session.membership.id, expires_at || null]
  );

  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values, after_values, reason)
     VALUES ($1, $2, 'score_override', 'alert', $3, '{}', $4, $5)`,
    [session.membership.company_id, session.membership.id, id,
     JSON.stringify({ target, value }), reason]
  );

  const asOfDate = getAsOfDate(session.company.time_zone);
  const result = await recalculateAlert(id, session.membership.company_id, asOfDate, "override");

  return NextResponse.json({ success: true, assessment: result });
}

/** Clear the active override for one factor (DELETE /api/alerts/:id/score?target=market_access). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["company_admin", "manager", "reviewer"].includes(session.membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = new URL(request.url).searchParams.get("target");
  const validTargets = ["market_access", "cost_to_implement", "urgency", "total"];
  if (!target || !validTargets.includes(target)) {
    return NextResponse.json({ error: `target must be one of: ${validTargets.join(", ")}` }, { status: 400 });
  }

  const ended = await query(
    `UPDATE score_overrides SET ended_at = NOW()
     WHERE alert_id = $1 AND company_id = $2 AND target = $3 AND ended_at IS NULL
     RETURNING value`,
    [id, session.membership.company_id, target]
  );
  if (ended.rows.length === 0) {
    return NextResponse.json({ error: "No active override for that factor" }, { status: 404 });
  }

  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values, after_values, reason)
     VALUES ($1, $2, 'score_override_cleared', 'alert', $3, $4, '{}', 'Override cleared')`,
    [session.membership.company_id, session.membership.id, id, JSON.stringify({ target, value: ended.rows[0].value })]
  );

  const asOfDate = getAsOfDate(session.company.time_zone);
  const result = await recalculateAlert(id, session.membership.company_id, asOfDate, "override_cleared");
  return NextResponse.json({ success: true, assessment: result });
}
