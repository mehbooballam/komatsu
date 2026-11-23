import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden } from "@/lib/auth-helpers";
import { canViewDashboard } from "@/lib/auth/permissions";

/**
 * Risk heatmap: urgency (time to deadline) against the resources needed (cost to implement).
 * Both come from each alert's latest score, so the chart moves on its own as scores change.
 * Sub-groups roll up to their top-level regulation group.
 */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canViewDashboard(auth.role, auth.access_scope)) return forbidden();

  const result = await query(
    `WITH RECURSIVE tree AS (
       SELECT id, id AS root_id, title AS root_title FROM regulation_groups
       WHERE company_id = $1 AND parent_group_id IS NULL AND state <> 'archived'
       UNION ALL
       SELECT g.id, t.root_id, t.root_title FROM regulation_groups g
       JOIN tree t ON g.parent_group_id = t.id
       WHERE g.company_id = $1 AND g.state <> 'archived'
     )
     SELECT a.id, a.title, a.external_alert_id,
            p.effective_priority AS priority, p.effective_total AS score,
            sa.effective_cost_to_implement AS cost, sa.effective_urgency AS urgency,
            t.root_id AS group_id, t.root_title AS group_name
     FROM alert_active_projections p
     JOIN alerts a ON a.id = p.alert_id AND a.company_id = p.company_id AND a.archived_at IS NULL
     LEFT JOIN score_assessments sa ON sa.id = p.latest_assessment_id
     LEFT JOIN tree t ON t.id = a.primary_group_id
     WHERE p.company_id = $1 AND p.is_active
     ORDER BY p.effective_total DESC NULLS LAST, a.external_alert_id`,
    [auth.company_id]
  );

  type Row = {
    id: string; title: string; external_alert_id: string | null; priority: string | null; score: number | null;
    cost: number | null; urgency: number | null; group_id: string | null; group_name: string | null;
  };
  const rows = result.rows as Row[];
  const placed = rows.filter((r) => r.cost !== null && r.urgency !== null);

  const alerts = placed.map((r) => ({
    id: r.id,
    title: r.title,
    ref: r.external_alert_id,
    priority: r.priority || "unscored",
    score: r.score,
    resources: Number(r.cost),
    urgency: Number(r.urgency),
    group_name: r.group_name,
  }));

  const byGroup = new Map<string, { id: string | null; name: string; items: Row[] }>();
  for (const r of placed) {
    const key = r.group_id ?? "none";
    const g = byGroup.get(key) ?? { id: r.group_id, name: r.group_name ?? "Not in a group", items: [] };
    g.items.push(r);
    byGroup.set(key, g);
  }
  const avg = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100;
  const groups = [...byGroup.values()]
    .map((g) => ({
      id: g.id,
      name: g.name,
      alert_count: g.items.length,
      resources: avg(g.items.map((r) => Number(r.cost))),
      urgency: avg(g.items.map((r) => Number(r.urgency))),
      critical: g.items.filter((r) => r.priority === "critical").length,
      high: g.items.filter((r) => r.priority === "high").length,
      top_score: Math.max(...g.items.map((r) => r.score ?? 0)),
    }))
    .sort((a, b) => b.alert_count - a.alert_count);

  return NextResponse.json({ groups, alerts, not_placed: rows.length - placed.length });
}
