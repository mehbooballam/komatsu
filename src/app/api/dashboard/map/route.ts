import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden } from "@/lib/auth-helpers";
import { canViewDashboard } from "@/lib/auth/permissions";
import { SUBDIVIDED, jurisdictionLabel, parseSubdivision } from "@/lib/geo/subdivisions";

const BANDS = ["critical", "high", "moderate", "low", "unscored"] as const;
type Band = (typeof BANDS)[number];

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

  // One row per alert: its jurisdiction, priority, score and the countries it is linked to
  const alertRes = await query(
    `SELECT a.id, a.jurisdiction_raw, COALESCE(p.effective_priority, 'unscored') AS priority, p.effective_total AS score,
            COALESCE(json_agg(json_build_object('code', g.code, 'name', g.display_name, 'manual', ag.source_evidence = 'manual'))
                     FILTER (WHERE g.id IS NOT NULL), '[]') AS geos
     FROM alerts a
     LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
     LEFT JOIN alert_geographies ag ON ag.alert_id = a.id AND ag.company_id = a.company_id AND ag.state <> 'rejected'
     LEFT JOIN geographies g ON g.id = ag.geography_id AND g.level = 'country'
     WHERE a.company_id = $1 AND a.archived_at IS NULL${filterClauses}
     GROUP BY a.id, a.jurisdiction_raw, p.effective_priority, p.effective_total`,
    params
  );

  const unmappedRes = await query(
    `SELECT COUNT(DISTINCT a.id) AS unmapped_count
     FROM alerts a
     LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
     WHERE a.company_id = $1 AND a.archived_at IS NULL${filterClauses}
       AND NOT EXISTS (
         -- Mapped to a country, or to a whole continent (level 'region')
         SELECT 1 FROM alert_geographies ag
         JOIN geographies g ON g.id = ag.geography_id AND g.level IN ('country', 'region')
         WHERE ag.alert_id = a.id AND ag.company_id = a.company_id AND ag.state <> 'rejected'
       )`,
    params
  );

  type Agg = { alert_count: number; max_score: number; by_band: Record<Band, number> };
  const empty = (): Agg => ({ alert_count: 0, max_score: 0, by_band: { critical: 0, high: 0, moderate: 0, low: 0, unscored: 0 } });
  const add = (a: Agg, band: Band, score: number) => {
    a.alert_count++;
    a.by_band[band]++;
    a.max_score = Math.max(a.max_score, score);
  };
  const highest = (a: Agg): Band => BANDS.find((b) => a.by_band[b] > 0) ?? "unscored";

  const countryAgg = new Map<string, Agg & { name: string }>();
  const subAgg = new Map<string, Agg & { country: string; name: string; label: string }>();
  const railAgg = new Map<string, Agg & { label: string; kind: "country" | "sub" | "off"; codes: Set<string>; sub: { country: string; name: string } | null }>();

  for (const r of alertRes.rows as Array<{ jurisdiction_raw: string | null; priority: string; score: number | null; geos: Array<{ code: string; name: string; manual: boolean }> }>) {
    const band = (BANDS as readonly string[]).includes(r.priority) ? (r.priority as Band) : "unscored";
    const score = Number(r.score) || 0;
    const sub = parseSubdivision(r.jurisdiction_raw);
    const onMapSub = sub && SUBDIVIDED.has(sub.country) ? sub : null;

    // Countries: a state rule does not paint its whole country (unless a person mapped it there)
    for (const g of r.geos) {
      if (onMapSub && g.code === onMapSub.country && !g.manual) continue;
      if (!countryAgg.has(g.code)) countryAgg.set(g.code, { ...empty(), name: g.name });
      add(countryAgg.get(g.code)!, band, score);
    }
    if (onMapSub) {
      const key = `${onMapSub.country}|${onMapSub.name.toLowerCase()}`;
      if (!subAgg.has(key)) subAgg.set(key, { ...empty(), country: onMapSub.country, name: onMapSub.name, label: jurisdictionLabel(r.jurisdiction_raw) });
      add(subAgg.get(key)!, band, score);
    }

    // Jurisdiction list: one row per jurisdiction label
    const label = jurisdictionLabel(r.jurisdiction_raw);
    if (!railAgg.has(label)) {
      railAgg.set(label, { ...empty(), label, kind: onMapSub ? "sub" : r.geos.length ? "country" : "off", codes: new Set(), sub: onMapSub });
    }
    const row = railAgg.get(label)!;
    add(row, band, score);
    for (const g of r.geos) row.codes.add(g.code);
    if (row.kind === "off" && r.geos.length) row.kind = "country";
  }

  const countries = [...countryAgg.entries()]
    .map(([code, a]) => ({ code, iso_code: code, display_name: a.name, alert_count: a.alert_count, highest_priority: highest(a), max_score: a.max_score, by_band: a.by_band }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const subdivisions = [...subAgg.values()].map((a) => ({
    country: a.country, name: a.name, label: a.label, alert_count: a.alert_count, highest_priority: highest(a), max_score: a.max_score, by_band: a.by_band,
  }));
  const rank = (b: Band) => BANDS.indexOf(b);
  const jurisdictions = [...railAgg.values()]
    .map((a) => ({
      label: a.label, kind: a.kind, codes: [...a.codes], sub: a.sub,
      alert_count: a.alert_count, highest_priority: highest(a), max_score: a.max_score,
    }))
    .sort((a, b) => rank(a.highest_priority) - rank(b.highest_priority) || b.max_score - a.max_score || b.alert_count - a.alert_count || a.label.localeCompare(b.label));

  return NextResponse.json({
    countries,
    subdivisions,
    jurisdictions,
    unmapped_count: parseInt(unmappedRes.rows[0]?.unmapped_count) || 0,
  });
}
