import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { cookies } from "next/headers";
import crypto from "crypto";

async function getAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get("komatsu_session")?.value;
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const res = await query(
    `SELECT s.user_id, m.id as membership_id, m.company_id, m.role, m.access_scope, c.time_zone
     FROM sessions s
     JOIN memberships m ON m.user_id = s.user_id AND m.state = 'active'
     JOIN companies c ON c.id = m.company_id
     WHERE s.token = $1 AND s.expires_at > now()
     ORDER BY (m.company_id::text = $2) DESC, m.joined_at ASC LIMIT 1`,
    [tokenHash, cookieStore.get("komatsu_company")?.value ?? ""]
  );
  return res.rows[0] || null;
}

export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = auth.company_id;
  const tz = auth.time_zone || "UTC";

  const frozenDate = process.env.COMPANY_FROZEN_DATE;
  const asOfExpr = frozenDate
    ? `'${frozenDate}'::date`
    : `(now() AT TIME ZONE '${tz}')::date`;

  const [totals, lastImport, scoreBands] = await Promise.all([
    query(
      `SELECT
        COUNT(*) FILTER (WHERE p.is_active) AS total_alerts,
        COUNT(*) FILTER (WHERE p.is_active AND p.effective_priority = 'critical') AS critical_count,
        COUNT(*) FILTER (WHERE p.is_active AND p.effective_priority = 'high') AS high_count,
        COUNT(*) FILTER (WHERE p.is_active AND p.effective_priority = 'moderate') AS moderate_count,
        COUNT(*) FILTER (WHERE p.is_active AND p.effective_priority = 'low') AS low_count,
        COUNT(*) FILTER (WHERE p.is_active AND (p.effective_priority IS NULL OR p.effective_priority = 'unscored')) AS unscored_count,
        COUNT(*) FILTER (WHERE p.is_active AND p.next_compliance_deadline >= ${asOfExpr}
          AND p.next_compliance_deadline <= (${asOfExpr} + INTERVAL '30 days')) AS due_soon_count,
        COUNT(*) FILTER (WHERE p.is_active AND COALESCE(a.direct_owner_membership_id, rg.owner_membership_id) IS NOT NULL) AS assigned_count,
        COUNT(*) FILTER (WHERE p.is_active AND (p.effective_total IS NULL OR p.latest_assessment_id IS NULL)) AS needs_review_count
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       WHERE p.company_id = $1`,
      [companyId]
    ),
    query(
      `SELECT MAX(completed_at) AS last_import_date
       FROM import_batches
       WHERE company_id = $1 AND status = 'completed'`,
      [companyId]
    ),
    // Band from the numeric score alone (before escalation), plus how many were escalated
    query(
      `SELECT COALESCE(sa.base_band, 'unscored') AS band,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE sa.base_band IS DISTINCT FROM p.effective_priority AND p.effective_priority IS NOT NULL)::int AS escalated
       FROM alert_active_projections p
       LEFT JOIN score_assessments sa ON sa.id = p.latest_assessment_id
       WHERE p.company_id = $1 AND p.is_active
       GROUP BY 1`,
      [companyId]
    ),
  ]);

  const row = totals.rows[0];
  return NextResponse.json({
    total_alerts: parseInt(row.total_alerts) || 0,
    critical_count: parseInt(row.critical_count) || 0,
    by_score_band: {
      critical: 0, high: 0, moderate: 0, low: 0, unscored: 0,
      ...Object.fromEntries(scoreBands.rows.map((r) => [r.band, r.count])),
    },
    escalated_count: scoreBands.rows.reduce((n, r) => n + r.escalated, 0),
    by_band: {
      critical: parseInt(row.critical_count) || 0,
      high: parseInt(row.high_count) || 0,
      moderate: parseInt(row.moderate_count) || 0,
      low: parseInt(row.low_count) || 0,
      unscored: parseInt(row.unscored_count) || 0,
    },
    due_soon_count: parseInt(row.due_soon_count) || 0,
    needs_review_count: parseInt(row.needs_review_count) || 0,
    // Alerts with an owner (directly or through their group)
    assigned_count: parseInt(row.assigned_count) || 0,
    last_import_date: lastImport.rows[0]?.last_import_date || null,
    as_of_date: frozenDate || new Date().toISOString().slice(0, 10),
  });
}
