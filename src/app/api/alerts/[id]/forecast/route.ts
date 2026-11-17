import { NextResponse } from "next/server";
import { format } from "date-fns";
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
    `SELECT f.*, u.display_name AS set_by_name
     FROM implementation_forecasts f
     LEFT JOIN memberships m ON m.id = f.set_by
     LEFT JOIN user_profiles u ON u.id = m.user_id
     WHERE f.alert_id = $1 AND f.company_id = $2
     ORDER BY f.created_at DESC`,
    [id, session.membership.company_id]
  );

  return NextResponse.json({ forecasts: res.rows });
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
  const { remaining_days, estimated_finish_date, reason, deadline_id } = body;

  if (deadline_id != null) {
    const deadline = await query(
      `SELECT 1 FROM alert_deadlines WHERE id::text = $1 AND alert_id = $2 AND company_id = $3`,
      [deadline_id, id, session.membership.company_id]
    );
    if (!deadline.rowCount) return NextResponse.json({ error: "Deadline not found" }, { status: 400 });
  }

  if (remaining_days === undefined && !estimated_finish_date) {
    return NextResponse.json({ error: "remaining_days or estimated_finish_date required" }, { status: 400 });
  }

  if (remaining_days !== undefined && remaining_days < 0) {
    return NextResponse.json({ error: "remaining_days must be non-negative" }, { status: 400 });
  }

  const asOfDate = getAsOfDate(session.company.time_zone);

  await query(
    `UPDATE implementation_forecasts SET status = 'superseded'
     WHERE alert_id = $1 AND company_id = $2 AND status = 'current'`,
    [id, session.membership.company_id]
  );

  const res = await query(
    `INSERT INTO implementation_forecasts
     (company_id, alert_id, deadline_id, remaining_days, estimated_finish_date, as_of_date, reason, set_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'current')
     RETURNING *`,
    [
      session.membership.company_id, id, deadline_id || null,
      remaining_days ?? null, estimated_finish_date || null,
      format(asOfDate, "yyyy-MM-dd"),
      reason || null, session.membership.id,
    ]
  );

  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values, reason)
     VALUES ($1, $2, 'forecast_set', 'alert', $3, $4, $5)`,
    [session.membership.company_id, session.membership.id, id,
     JSON.stringify({ remaining_days, estimated_finish_date }), reason || null]
  );

  const result = await recalculateAlert(id, session.membership.company_id, asOfDate, "forecast_change");

  return NextResponse.json({ forecast: res.rows[0], assessment: result }, { status: 201 });
}
