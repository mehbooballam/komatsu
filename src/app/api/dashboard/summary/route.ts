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
     ORDER BY s.last_active_at DESC LIMIT 1`,
    [tokenHash]
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

  const [totals, lastImport] = await Promise.all([
    query(
      `SELECT
        COUNT(*) FILTER (WHERE p.is_active) AS total_alerts,
        COUNT(*) FILTER (WHERE p.is_active AND p.effective_priority = 'critical') AS critical_count,
        COUNT(*) FILTER (WHERE p.is_active AND p.next_compliance_deadline IS NOT NULL
          AND p.next_compliance_deadline <= (${asOfExpr} + INTERVAL '30 days')) AS due_soon_count,
        COUNT(*) FILTER (WHERE p.is_active AND (p.effective_total IS NULL OR p.latest_assessment_id IS NULL)) AS needs_review_count
       FROM alert_active_projections p
       WHERE p.company_id = $1`,
      [companyId]
    ),
    query(
      `SELECT MAX(completed_at) AS last_import_date
       FROM import_batches
       WHERE company_id = $1 AND status = 'completed'`,
      [companyId]
    ),
  ]);

  const row = totals.rows[0];
  return NextResponse.json({
    total_alerts: parseInt(row.total_alerts) || 0,
    critical_count: parseInt(row.critical_count) || 0,
    due_soon_count: parseInt(row.due_soon_count) || 0,
    needs_review_count: parseInt(row.needs_review_count) || 0,
    last_import_date: lastImport.rows[0]?.last_import_date || null,
    as_of_date: frozenDate || new Date().toISOString().slice(0, 10),
  });
}
