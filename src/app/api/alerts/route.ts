import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized } from "@/lib/auth-helpers";
import { alertScopeSql } from "@/lib/alerts/access";
import { getWorkspaceDate } from "@/lib/workspace-date";
import { loadGroupTree, inGroupSubtreeSql } from "@/lib/groups";
import { alertProducts } from "@/lib/products";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();

  const companyId = auth.company_id;
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") || "25")));
  const offset = (page - 1) * perPage;
  const searchQuery = searchParams.get("q") ?? searchParams.get("search");
  // Comma-separated multi-value filters: ?priority=critical,high
  const list = (key: string) =>
    (searchParams.get(key) || "").split(",").map((v) => v.trim()).filter(Boolean);
  const sortBy = searchParams.get("sort") || "priority";
  const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC";

  const filters: string[] = ["a.company_id = $1", "a.archived_at IS NULL"];
  const params: unknown[] = [companyId];
  let paramIdx = 2;

  // Filter: priority
  const priorities = list("priority");
  if (priorities.length) {
    const wantsUnscored = priorities.includes("unscored");
    filters.push(
      wantsUnscored
        ? `(p.effective_priority = ANY($${paramIdx}::text[]) OR p.effective_priority IS NULL)`
        : `p.effective_priority = ANY($${paramIdx}::text[])`
    );
    params.push(priorities);
    paramIdx++;
  }

  // Filter: stage
  const stages = list("stage");
  if (stages.length) {
    filters.push(`a.stage = ANY($${paramIdx}::text[])`);
    params.push(stages);
    paramIdx++;
  }

  // Filter: geography
  const geographies = list("geography");
  if (geographies.includes("unmapped")) {
    filters.push(`NOT EXISTS (
      SELECT 1 FROM alert_geographies ag WHERE ag.alert_id = a.id AND ag.state != 'rejected'
    )`);
  } else if (geographies.length) {
    filters.push(`EXISTS (
      SELECT 1 FROM alert_geographies ag
      JOIN geographies g ON g.id = ag.geography_id
      WHERE ag.alert_id = a.id AND g.code = ANY($${paramIdx}::text[]) AND ag.state != 'rejected'
    )`);
    params.push(geographies);
    paramIdx++;
  }

  // Filter: group
  const groupId = searchParams.get("group_id");
  if (groupId === "none") {
    filters.push(`a.primary_group_id IS NULL`);
  } else if (groupId && !UUID_RE.test(groupId)) {
    filters.push("FALSE");
  } else if (groupId) {
    // A group includes everything filed in its sub-groups too
    filters.push(inGroupSubtreeSql("a.primary_group_id", `$${paramIdx}`));
    params.push(groupId);
    paramIdx++;
  }

  // Filter: owner
  const ownerId = searchParams.get("owner_id");
  if (ownerId === "unassigned") {
    filters.push(`COALESCE(a.direct_owner_membership_id, (SELECT owner_membership_id FROM regulation_groups WHERE id = a.primary_group_id)) IS NULL`);
  } else if (ownerId) {
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

  // Filter: deadline window. "Today" is the workspace's calendar date, not the database server's (UTC).
  const deadlineWithin = searchParams.get("deadline_within");
  if (deadlineWithin === "overdue") {
    filters.push(`p.next_compliance_deadline < $${paramIdx}::date`);
    params.push(getWorkspaceDate(auth.time_zone));
    paramIdx++;
  } else if (deadlineWithin === "none") {
    filters.push(`p.next_compliance_deadline IS NULL`);
  } else if (deadlineWithin && /^\d+$/.test(deadlineWithin)) {
    // Upcoming only: today up to N days ahead (overdue alerts have their own filter)
    filters.push(`p.next_compliance_deadline >= $${paramIdx}::date
      AND p.next_compliance_deadline <= $${paramIdx}::date + $${paramIdx + 1}::int`);
    params.push(getWorkspaceDate(auth.time_zone), parseInt(deadlineWithin, 10));
    paramIdx += 2;
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

  filters.push(alertScopeSql(auth, params, searchParams.get("assigned_to_me") === "true"));
  paramIdx = params.length + 1;

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
       owner_u.display_name AS owner_name,
       owner_u.preferences->>'avatar' AS owner_avatar,
       sa.base_band AS score_band,
       sa.escalation_reasons
     FROM alerts a
     LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
     LEFT JOIN score_assessments sa ON sa.id = p.latest_assessment_id
     LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id AND rg.company_id = a.company_id
     LEFT JOIN memberships owner_m ON owner_m.id = COALESCE(a.direct_owner_membership_id, rg.owner_membership_id) AND owner_m.company_id = a.company_id
     LEFT JOIN user_profiles owner_u ON owner_u.id = owner_m.user_id
     WHERE ${whereClause}
     ORDER BY ${orderClause}
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, perPage, offset]
  );

  // Fetch geographies for displayed alerts
  const alertIds = alertsResult.rows.map((r: { id: string }) => r.id);
  const geoMap: Record<string, string[]> = {};
  const productMap: Record<string, string[]> = {};

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

  }

  const tree = await loadGroupTree(auth.company_id);
  const groupPaths = new Map(tree.map((g) => [g.id, g.path]));
  // Products attached to the alert plus those inherited from its group and parent groups
  const attached = await alertProducts(auth.company_id, alertIds, tree);
  for (const [id, list] of attached) productMap[id] = list.map((p) => p.name);

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
    // Band from the numeric score alone, before escalation rules raise it
    score_band: row.score_band || (row.effective_total == null ? "unscored" : null),
    escalation_reasons: row.escalation_reasons || [],
    next_compliance_deadline: row.next_compliance_deadline,
    days_remaining: row.days_remaining,
    group_id: row.group_id,
    group_title: row.group_title,
    group_path: row.group_id ? groupPaths.get(row.group_id as string) || [row.group_title] : null,
    owner_membership_id: row.owner_membership_id,
    owner_name: row.owner_name,
    owner_avatar: row.owner_avatar || null,
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
