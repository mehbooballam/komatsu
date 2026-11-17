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

const PRIORITY_SORT_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  unscored: 4,
};

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = auth.company_id;
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") || "25")));
  const offset = (page - 1) * perPage;
  const searchQuery = searchParams.get("q");
  const sortBy = searchParams.get("sort") || "priority";
  const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC";

  const filters: string[] = ["a.company_id = $1", "a.archived_at IS NULL"];
  const params: unknown[] = [companyId];
  let paramIdx = 2;

  // Filter: priority
  const priority = searchParams.get("priority");
  if (priority) {
    filters.push(`p.effective_priority = $${paramIdx}`);
    params.push(priority);
    paramIdx++;
  }

  // Filter: stage
  const stage = searchParams.get("stage");
  if (stage) {
    filters.push(`a.stage = $${paramIdx}`);
    params.push(stage);
    paramIdx++;
  }

  // Filter: geography
  const geography = searchParams.get("geography");
  if (geography) {
    filters.push(`EXISTS (
      SELECT 1 FROM alert_geographies ag
      JOIN geographies g ON g.id = ag.geography_id
      WHERE ag.alert_id = a.id AND g.code = $${paramIdx} AND ag.state != 'rejected'
    )`);
    params.push(geography);
    paramIdx++;
  }

  // Filter: group
  const groupId = searchParams.get("group_id");
  if (groupId) {
    filters.push(`a.primary_group_id = $${paramIdx}`);
    params.push(groupId);
    paramIdx++;
  }

  // Filter: owner
  const ownerId = searchParams.get("owner_id");
  if (ownerId) {
    filters.push(`(a.direct_owner_membership_id = $${paramIdx} OR
      (a.direct_owner_membership_id IS NULL AND a.primary_group_id IN (
        SELECT id FROM regulation_groups WHERE owner_membership_id = $${paramIdx}
      )))`);
    params.push(ownerId);
    paramIdx++;
  }

  // Filter: local_state
  const localState = searchParams.get("status");
  if (localState) {
    filters.push(`a.local_state = $${paramIdx}`);
    params.push(localState);
    paramIdx++;
  }

  // Filter: deadline window
  const deadlineWithin = searchParams.get("deadline_within");
  if (deadlineWithin) {
    filters.push(`p.next_compliance_deadline IS NOT NULL AND p.next_compliance_deadline <= (CURRENT_DATE + ($${paramIdx} || ' days')::INTERVAL)`);
    params.push(deadlineWithin);
    paramIdx++;
  }

  // Filter: missing data / needs review
  const needsReview = searchParams.get("needs_review");
  if (needsReview === "true") {
    filters.push(`(p.effective_total IS NULL OR p.latest_assessment_id IS NULL)`);
  }

  // Full-text search
  if (searchQuery && searchQuery.trim()) {
    filters.push(`(
      to_tsvector('english', COALESCE(a.title, '') || ' ' || COALESCE(a.overview, '') || ' ' || COALESCE(a.summary, '') || ' ' || COALESCE(a.relevance, '') || ' ' || COALESCE(a.external_alert_id, ''))
      @@ plainto_tsquery('english', $${paramIdx})
      OR a.external_alert_id ILIKE '%' || $${paramIdx} || '%'
      OR a.title ILIKE '%' || $${paramIdx} || '%'
    )`);
    params.push(searchQuery.trim());
    paramIdx++;
  }

  // Risk owner scope restriction
  if (auth.role === "risk_owner") {
    filters.push(`(
      a.direct_owner_membership_id = $${paramIdx}
      OR (a.direct_owner_membership_id IS NULL AND a.primary_group_id IN (
        SELECT id FROM regulation_groups WHERE owner_membership_id = $${paramIdx}
      ))
    )`);
    params.push(auth.membership_id);
    paramIdx++;
  }

  const whereClause = filters.join(" AND ");

  let orderClause: string;
  switch (sortBy) {
    case "score":
      orderClause = `p.effective_total ${sortDir} NULLS LAST`;
      break;
    case "deadline":
      orderClause = `p.next_compliance_deadline ${sortDir} NULLS LAST`;
      break;
    case "title":
      orderClause = `a.title ${sortDir}`;
      break;
    case "priority":
    default:
      orderClause = `
        CASE p.effective_priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'moderate' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END ASC,
        p.effective_total DESC NULLS LAST,
        p.next_compliance_deadline ASC NULLS LAST,
        a.external_alert_id ASC`;
      break;
  }

  const countResult = await query(
    `SELECT COUNT(*) AS total
     FROM alerts a
     LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
     WHERE ${whereClause}`,
    params
  );

  const total = parseInt(countResult.rows[0].total);

  const alertsResult = await query(
    `SELECT
       a.id,
       a.external_alert_id,
       a.title,
       a.overview,
       a.stage,
       a.jurisdiction_raw,
       a.product_raw,
       a.source_url,
       a.local_state,
       a.timing_raw,
       a.record_version,
       p.effective_total,
       p.effective_priority,
       p.next_compliance_deadline,
       p.days_remaining,
       p.effective_owner_id,
       rg.title AS group_title,
       rg.id AS group_id,
       owner_m.id AS owner_membership_id,
       owner_u.display_name AS owner_name
     FROM alerts a
     LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
     LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
     LEFT JOIN memberships owner_m ON owner_m.id = COALESCE(a.direct_owner_membership_id, rg.owner_membership_id)
     LEFT JOIN user_profiles owner_u ON owner_u.id = owner_m.user_id
     WHERE ${whereClause}
     ORDER BY ${orderClause}
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, perPage, offset]
  );

  // Fetch geographies for displayed alerts
  const alertIds = alertsResult.rows.map((r: { id: string }) => r.id);
  let geoMap: Record<string, string[]> = {};
  let productMap: Record<string, string[]> = {};

  if (alertIds.length > 0) {
    const geoResult = await query(
      `SELECT ag.alert_id, g.display_name, g.code
       FROM alert_geographies ag
       JOIN geographies g ON g.id = ag.geography_id
       WHERE ag.alert_id = ANY($1) AND ag.state != 'rejected'`,
      [alertIds]
    );
    for (const row of geoResult.rows) {
      if (!geoMap[row.alert_id]) geoMap[row.alert_id] = [];
      geoMap[row.alert_id].push(row.display_name);
    }

    const prodResult = await query(
      `SELECT apl.alert_id,
              COALESCE(pf.name, pr.name) AS product_name,
              apl.state AS link_state
       FROM alert_product_links apl
       LEFT JOIN product_families pf ON pf.id = apl.family_id
       LEFT JOIN products pr ON pr.id = apl.product_id
       WHERE apl.alert_id = ANY($1) AND apl.state != 'rejected'`,
      [alertIds]
    );
    for (const row of prodResult.rows) {
      if (!productMap[row.alert_id]) productMap[row.alert_id] = [];
      productMap[row.alert_id].push(row.product_name);
    }
  }

  const alerts = alertsResult.rows.map((row: Record<string, unknown>) => ({
    id: row.id,
    external_alert_id: row.external_alert_id,
    title: row.title,
    overview: row.overview,
    stage: row.stage,
    jurisdiction_raw: row.jurisdiction_raw,
    geographies: geoMap[row.id as string] || [],
    products: productMap[row.id as string] || [],
    product_raw: row.product_raw,
    source_url: row.source_url,
    local_state: row.local_state,
    timing_raw: row.timing_raw,
    effective_total: row.effective_total,
    effective_priority: row.effective_priority || "unscored",
    next_compliance_deadline: row.next_compliance_deadline,
    days_remaining: row.days_remaining,
    group_id: row.group_id,
    group_title: row.group_title,
    owner_membership_id: row.owner_membership_id,
    owner_name: row.owner_name,
    record_version: row.record_version,
  }));

  return NextResponse.json({
    alerts,
    pagination: {
      page,
      per_page: perPage,
      total,
      total_pages: Math.ceil(total / perPage),
    },
  });
}
