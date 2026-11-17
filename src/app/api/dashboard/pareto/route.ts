import { NextRequest, NextResponse } from "next/server";
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

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = auth.company_id;
  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

  const result = await query(
    `SELECT
       a.id AS alert_id,
       a.external_alert_id,
       a.title,
       p.effective_total,
       p.effective_priority
     FROM alert_active_projections p
     JOIN alerts a ON a.id = p.alert_id
     WHERE p.company_id = $1
       AND p.is_active = TRUE
       AND p.effective_total IS NOT NULL
     ORDER BY p.effective_total DESC, a.external_alert_id ASC`,
    [companyId]
  );

  const allAlerts = result.rows;
  const totalSum = allAlerts.reduce(
    (sum: number, r: { effective_total: number }) => sum + (r.effective_total || 0),
    0
  );

  const displayed = allAlerts.slice(0, limit);
  let runningSum = 0;
  const paretoData = displayed.map((row: {
    alert_id: string;
    external_alert_id: string;
    title: string;
    effective_total: number;
    effective_priority: string;
  }) => {
    runningSum += row.effective_total || 0;
    return {
      alert_id: row.alert_id,
      external_alert_id: row.external_alert_id,
      title: row.title,
      score: row.effective_total,
      priority: row.effective_priority,
      cumulative_pct: totalSum > 0 ? Math.round((runningSum / totalSum) * 10000) / 100 : 0,
    };
  });

  return NextResponse.json({
    data: paretoData,
    total_sum: totalSum,
    total_scored_count: allAlerts.length,
    displayed_count: displayed.length,
  });
}
