import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { alertNotFound, canAccessAlert } from "@/lib/alerts/access";
import { recalculateAlert, getAsOfDate } from "@/lib/scoring/recalculate";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessAlert({ ...session.membership, membership_id: session.membership.id }, id))) return alertNotFound();

  const res = await query(
    `SELECT ad.*, u.display_name AS confirmed_by_name
     FROM alert_deadlines ad
     LEFT JOIN memberships m ON m.id = ad.confirmed_by
     LEFT JOIN user_profiles u ON u.id = m.user_id
     WHERE ad.alert_id = $1 AND ad.company_id = $2
     ORDER BY ad.date_value ASC`,
    [id, session.membership.company_id]
  );

  return NextResponse.json({ deadlines: res.rows });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["company_admin", "manager", "reviewer"].includes(session.membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessAlert({ ...session.membership, membership_id: session.membership.id }, id))) return alertNotFound();

  const body = await request.json();
  const { date_value, kind, verification_state, applies_to, evidence } = body;

  if (!date_value || !kind) {
    return NextResponse.json({ error: "date_value and kind are required" }, { status: 400 });
  }
  if (typeof date_value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date_value) || Number.isNaN(Date.parse(date_value))) {
    return NextResponse.json({ error: "Enter a valid date (YYYY-MM-DD)" }, { status: 400 });
  }
  if (applies_to && String(applies_to).length > 300) {
    return NextResponse.json({ error: "Note is too long (max 300 characters)" }, { status: 400 });
  }

  const validKinds = ["compliance", "comment", "effective", "internal", "proposed", "unknown"];
  if (!validKinds.includes(kind)) {
    return NextResponse.json({ error: `Invalid kind. Must be one of: ${validKinds.join(", ")}` }, { status: 400 });
  }

  const verState = verification_state || "unverified";
  const confirmed = verState === "verified" ? session.membership.id : null;
  const confirmedAt = verState === "verified" ? new Date().toISOString() : null;

  const res = await query(
    `INSERT INTO alert_deadlines (company_id, alert_id, kind, date_value, applies_to, verification_state, origin, confirmed_by, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8)
     RETURNING *`,
    [session.membership.company_id, id, kind, date_value, applies_to || null, verState, confirmed, confirmedAt]
  );

  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values, reason)
     VALUES ($1, $2, 'deadline_added', 'alert', $3, $4, $5)`,
    [session.membership.company_id, session.membership.id, id,
     JSON.stringify({ date_value, kind, verification_state: verState }), evidence || null]
  );

  const asOfDate = getAsOfDate(session.company.time_zone);
  await recalculateAlert(id, session.membership.company_id, asOfDate, "deadline_change");

  return NextResponse.json({ deadline: res.rows[0] }, { status: 201 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: alertId } = await params;
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["company_admin", "manager", "reviewer"].includes(session.membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessAlert({ ...session.membership, membership_id: session.membership.id }, alertId))) return alertNotFound();

  const body = await request.json();
  const { deadline_id, verification_state, lifecycle_state, kind } = body;

  if (!deadline_id) {
    return NextResponse.json({ error: "deadline_id is required" }, { status: 400 });
  }

  const existing = await query(
    `SELECT * FROM alert_deadlines WHERE id = $1 AND alert_id = $2 AND company_id = $3`,
    [deadline_id, alertId, session.membership.company_id]
  );
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Deadline not found" }, { status: 404 });
  }

  const before = existing.rows[0];
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (verification_state) {
    updates.push(`verification_state = $${paramIdx++}`);
    values.push(verification_state);
    if (verification_state === "verified") {
      updates.push(`confirmed_by = $${paramIdx++}`);
      values.push(session.membership.id);
      updates.push(`confirmed_at = $${paramIdx++}`);
      values.push(new Date().toISOString());
    }
  }
  if (lifecycle_state) {
    updates.push(`lifecycle_state = $${paramIdx++}`);
    values.push(lifecycle_state);
    if (lifecycle_state === "completed") {
      updates.push(`completed_at = $${paramIdx++}`);
      values.push(new Date().toISOString());
    }
  }
  if (kind) {
    updates.push(`kind = $${paramIdx++}`);
    values.push(kind);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  values.push(deadline_id, alertId, session.membership.company_id);
  const res = await query(
    `UPDATE alert_deadlines SET ${updates.join(", ")}
     WHERE id = $${paramIdx} AND alert_id = $${paramIdx + 1} AND company_id = $${paramIdx + 2} RETURNING *`,
    values
  );
  if (res.rows.length === 0) return NextResponse.json({ error: "Deadline not found" }, { status: 404 });

  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values, after_values)
     VALUES ($1, $2, 'deadline_updated', 'alert', $3, $4, $5)`,
    [session.membership.company_id, session.membership.id, alertId,
     JSON.stringify({ verification_state: before.verification_state, lifecycle_state: before.lifecycle_state, kind: before.kind }),
     JSON.stringify({ verification_state: res.rows[0].verification_state, lifecycle_state: res.rows[0].lifecycle_state, kind: res.rows[0].kind })]
  );

  const asOfDate = getAsOfDate(session.company.time_zone);
  await recalculateAlert(alertId, session.membership.company_id, asOfDate, "deadline_change");

  return NextResponse.json({ deadline: res.rows[0] });
}
