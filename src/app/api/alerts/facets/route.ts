import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { loadGroupTree } from "@/lib/groups";
import { CONTINENTS, CONTINENT_PREFIX, continentOfGeography } from "@/lib/geo/continents";

/** Filter options with counts for the Alerts page (stages, countries, groups, owners, priorities). */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  const companyId = auth.company_id;

  const [stages, countries, groups, owners, priorities, ungrouped, unassigned, countryLinks] = await Promise.all([
    query(
      `SELECT stage AS value, COUNT(*)::int AS count FROM alerts
       WHERE company_id = $1 AND archived_at IS NULL AND stage IS NOT NULL AND stage <> ''
       GROUP BY stage ORDER BY count DESC`,
      [companyId]
    ),
    query(
      `SELECT g.code AS value, g.display_name AS label, COUNT(DISTINCT a.id)::int AS count
       FROM alert_geographies ag
       JOIN geographies g ON g.id = ag.geography_id AND g.level = 'country'
       JOIN alerts a ON a.id = ag.alert_id AND a.company_id = ag.company_id AND a.archived_at IS NULL
       WHERE ag.company_id = $1 AND ag.state <> 'rejected'
       GROUP BY g.code, g.display_name
       UNION ALL
       SELECT 'unmapped', 'Unmapped', COUNT(*)::int
       FROM alerts a
       WHERE a.company_id = $1 AND a.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM alert_geographies ag
           JOIN geographies g ON g.id = ag.geography_id AND g.level IN ('country', 'region')
           WHERE ag.alert_id = a.id AND ag.company_id = a.company_id AND ag.state <> 'rejected'
         )
       ORDER BY count DESC, label`,
      [companyId]
    ),
    loadGroupTree(companyId),
    query(
      `SELECT m.id AS value, up.display_name AS label,
              (SELECT COUNT(*)::int FROM alerts a WHERE a.company_id = $1 AND a.archived_at IS NULL AND a.direct_owner_membership_id = m.id) AS count
       FROM memberships m JOIN user_profiles up ON up.id = m.user_id
       WHERE m.company_id = $1 AND m.state = 'active'
       ORDER BY up.display_name`,
      [companyId]
    ),
    query(
      `SELECT COALESCE(p.effective_priority, 'unscored') AS value, COUNT(*)::int AS count
       FROM alerts a LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
       WHERE a.company_id = $1 AND a.archived_at IS NULL
       GROUP BY 1`,
      [companyId]
    ),
    query(`SELECT COUNT(*)::int AS count FROM alerts WHERE company_id = $1 AND archived_at IS NULL AND primary_group_id IS NULL`, [companyId]),
    query(
      `SELECT COUNT(*)::int AS count FROM alerts a
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id AND rg.company_id = a.company_id
       WHERE a.company_id = $1 AND a.archived_at IS NULL AND COALESCE(a.direct_owner_membership_id, rg.owner_membership_id) IS NULL`,
      [companyId]
    ),
    // Alert ↔ country/continent pairs, rolled up into continents below
    query(
      `SELECT DISTINCT ag.alert_id, g.code
       FROM alert_geographies ag
       JOIN geographies g ON g.id = ag.geography_id AND g.level IN ('country', 'region')
       JOIN alerts a ON a.id = ag.alert_id AND a.company_id = ag.company_id AND a.archived_at IS NULL
       WHERE ag.company_id = $1 AND ag.state <> 'rejected'`,
      [companyId]
    ),
  ]);

  // Distinct alerts per continent (an alert in France and Germany counts once for Europe)
  const perContinent = new Map<string, Set<string>>();
  for (const r of countryLinks.rows) {
    const c = continentOfGeography(r.code);
    if (!c) continue;
    if (!perContinent.has(c)) perContinent.set(c, new Set());
    perContinent.get(c)!.add(r.alert_id);
  }

  return NextResponse.json({
    stages: stages.rows.map((r) => ({ value: r.value, label: r.value, count: r.count })),
    // All continents first (even with no alerts), then the countries that have alerts
    continents: CONTINENTS.map((c) => ({ value: `${CONTINENT_PREFIX}${c.code}`, label: c.name, count: perContinent.get(c.code)?.size ?? 0 })),
    countries: countries.rows,
    // count includes alerts in sub-groups
    groups: groups.map((g) => ({
      value: g.id,
      label: g.title,
      count: g.total_count,
      parent: g.parent_group_id,
      depth: g.depth,
      path: g.path,
    })),
    ungrouped_count: ungrouped.rows[0].count,
    owners: owners.rows,
    unassigned_count: unassigned.rows[0].count,
    priorities: Object.fromEntries(priorities.rows.map((r) => [r.value, r.count])),
  });
}
