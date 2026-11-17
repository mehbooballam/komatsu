import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden } from "@/lib/auth-helpers";
import { canViewDashboard } from "@/lib/auth/permissions";

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canViewDashboard(auth.role, auth.access_scope)) return forbidden();

  const companyId = auth.company_id;
  const searchParams = request.nextUrl.searchParams;
  const priorityFilter = searchParams.get("priority");
  const stageFilter = searchParams.get("stage");

  let filterClauses = "";
  const params: unknown[] = [companyId];
  let paramIdx = 2;

  if (priorityFilter) {
    filterClauses += ` AND p.effective_priority = $${paramIdx}`;
    params.push(priorityFilter);
    paramIdx++;
  }
  if (stageFilter) {
    filterClauses += ` AND a.stage = $${paramIdx}`;
    params.push(stageFilter);
    paramIdx++;
  }

  const geoData = await query(
    `SELECT
       g.code,
       g.iso_code,
       g.display_name,
       COUNT(DISTINCT a.id) AS alert_count,
       COUNT(DISTINCT a.id) FILTER (WHERE p.effective_priority = 'critical') AS critical_count,
       COUNT(DISTINCT a.id) FILTER (WHERE p.effective_priority = 'high') AS high_count,
       COUNT(DISTINCT a.id) FILTER (WHERE p.effective_priority = 'moderate') AS moderate_count,
       COUNT(DISTINCT a.id) FILTER (WHERE p.effective_priority = 'low') AS low_count,
       COUNT(DISTINCT a.id) FILTER (WHERE p.effective_priority IS NULL OR p.effective_priority = 'unscored') AS unscored_count
     FROM alert_geographies ag
     JOIN geographies g ON g.id = ag.geography_id
     JOIN alerts a ON a.id = ag.alert_id AND a.company_id = ag.company_id AND a.archived_at IS NULL
     LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
     WHERE ag.company_id = $1 AND ag.state != 'rejected'${filterClauses}
     GROUP BY g.id, g.code, g.iso_code, g.display_name
     ORDER BY g.display_name`,
    params
  );

  const unmappedRes = await query(
    `SELECT COUNT(DISTINCT a.id) AS unmapped_count
     FROM alerts a
     LEFT JOIN alert_geographies ag ON ag.alert_id = a.id AND ag.company_id = a.company_id AND ag.state != 'rejected'
     LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
     WHERE a.company_id = $1 AND a.archived_at IS NULL AND ag.id IS NULL${filterClauses}`,
    params
  );

  const countries = geoData.rows.map((row) => {
    let highestPriority = "unscored";
    if (parseInt(row.critical_count) > 0) highestPriority = "critical";
    else if (parseInt(row.high_count) > 0) highestPriority = "high";
    else if (parseInt(row.moderate_count) > 0) highestPriority = "moderate";
    else if (parseInt(row.low_count) > 0) highestPriority = "low";

    return {
      code: row.code,
      iso_code: row.iso_code,
      display_name: row.display_name,
      alert_count: parseInt(row.alert_count),
      highest_priority: highestPriority,
      by_band: {
        critical: parseInt(row.critical_count),
        high: parseInt(row.high_count),
        moderate: parseInt(row.moderate_count),
        low: parseInt(row.low_count),
        unscored: parseInt(row.unscored_count),
      },
    };
  });

  return NextResponse.json({
    countries,
    unmapped_count: parseInt(unmappedRes.rows[0]?.unmapped_count) || 0,
  });
}
