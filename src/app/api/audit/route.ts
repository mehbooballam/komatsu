import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden } from "@/lib/auth-helpers";
import { canViewAudit } from "@/lib/auth/permissions";
import { alertNotFound, canAccessAlert } from "@/lib/alerts/access";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plain-language areas shown as filters on the Audit page → the entity types they cover. */
const CATEGORIES: Record<string, string[]> = {
  alerts: ["alert"],
  groups: ["regulation_group"],
  products: ["product", "product_family"],
  imports: ["import_batch"],
  scoring: ["scoring_policy"],
  reports: ["risk_report"],
  workspace: ["company", "invitation", "team"],
  account: ["user"],
};

/** Every UUID mentioned in an event (entity id and any id inside its before/after values). */
function collectIds(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    if (UUID_RE.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value.slice(0, 50)) collectIds(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectIds(v, out);
  }
}

/** Resolves ids to readable names (alert titles, group names, people, products …) within this workspace. */
async function resolveNames(companyId: string, ids: string[]): Promise<Record<string, { kind: string; name: string }>> {
  const refs: Record<string, { kind: string; name: string }> = {};
  if (ids.length === 0) return refs;
  const res = await query(
    `SELECT id::text, 'alert' AS kind, title AS name FROM alerts WHERE company_id = $1 AND id = ANY($2::uuid[])
     UNION ALL SELECT id::text, 'group', title FROM regulation_groups WHERE company_id = $1 AND id = ANY($2::uuid[])
     UNION ALL SELECT id::text, 'product_family', name FROM product_families WHERE company_id = $1 AND id = ANY($2::uuid[])
     UNION ALL SELECT id::text, 'product', name || COALESCE(' (' || model_code || ')', '') FROM products WHERE company_id = $1 AND id = ANY($2::uuid[])
     UNION ALL SELECT m.id::text, 'person', up.display_name FROM memberships m JOIN user_profiles up ON up.id = m.user_id
               WHERE m.company_id = $1 AND m.id = ANY($2::uuid[])
     UNION ALL SELECT up.id::text, 'person', up.display_name FROM user_profiles up
               JOIN memberships m ON m.user_id = up.id AND m.company_id = $1 WHERE up.id = ANY($2::uuid[])
     UNION ALL SELECT id::text, 'import', original_filename FROM import_batches WHERE company_id = $1 AND id = ANY($2::uuid[])
     UNION ALL SELECT id::text, 'workspace', name FROM companies WHERE id = $1 AND id = ANY($2::uuid[])
     UNION ALL SELECT id::text, 'report', title FROM risk_reports WHERE company_id = $1 AND id = ANY($2::uuid[])
     UNION ALL SELECT id::text, 'scoring_policy', 'Scoring policy v' || version FROM scoring_policies WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, ids]
  );
  for (const r of res.rows) if (!refs[r.id]) refs[r.id] = { kind: r.kind, name: r.name };
  return refs;
}

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50") || 50, 1), 100);
  const offset = (page - 1) * limit;
  const action = searchParams.get("action");
  const entityType = searchParams.get("entity_type");
  const category = searchParams.get("category");
  const actorId = searchParams.get("actor_id");
  const entityId = searchParams.get("entity_id");
  const workspaceAudit = canViewAudit(auth.role);
  if (!workspaceAudit) {
    if (auth.role !== "reviewer" || !entityId) return forbidden();
    if (!(await canAccessAlert(auth, entityId))) return alertNotFound();
  }
  const hideLogins = searchParams.get("hide_logins") === "true";
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const conditions: string[] = ["ae.company_id = $1"];
  const params: unknown[] = [auth.company_id];
  let idx = 2;

  if (action) { conditions.push(`ae.action = $${idx++}`); params.push(action); }
  if (entityType) { conditions.push(`ae.entity_type = $${idx++}`); params.push(entityType); }
  if (category && CATEGORIES[category]) { conditions.push(`ae.entity_type = ANY($${idx++}::text[])`); params.push(CATEGORIES[category]); }
  if (actorId && UUID_RE.test(actorId)) { conditions.push(`ae.actor_membership_id = $${idx++}`); params.push(actorId); }
  if (hideLogins) conditions.push(`ae.action <> 'user.login'`);
  if (entityId) {
    // Workspace audit includes events about other entities that reference this alert.
    // A reviewer sees only events recorded for the accessible alert itself.
    conditions.push(workspaceAudit
      ? `(ae.entity_id::text = $${idx} OR ae.after_values->>'alert_id' = $${idx} OR ae.before_values->>'alert_id' = $${idx})`
      : `(ae.entity_type = 'alert' AND ae.entity_id = $${idx})`);
    idx++;
    params.push(entityId);
  }
  if (from) { conditions.push(`ae.occurred_at >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`ae.occurred_at <= $${idx++}`); params.push(to); }

  const where = conditions.join(" AND ");

  const [countRes, events, actors] = await Promise.all([
    query(`SELECT COUNT(*) FROM audit_events ae WHERE ${where}`, params),
    query(
      `SELECT ae.*, up.display_name as actor_name, up.preferences->>'avatar' AS actor_avatar
       FROM audit_events ae
       LEFT JOIN memberships m ON m.id = ae.actor_membership_id
       LEFT JOIN user_profiles up ON up.id = m.user_id
       WHERE ${where}
       ORDER BY ae.occurred_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
    // People who appear in the log, for the "Who" filter
    workspaceAudit ? query(
      `SELECT DISTINCT m.id, up.display_name AS name
       FROM audit_events ae JOIN memberships m ON m.id = ae.actor_membership_id
       JOIN user_profiles up ON up.id = m.user_id
       WHERE ae.company_id = $1 ORDER BY name`,
      [auth.company_id]
    ) : { rows: [] },
  ]);
  const total = parseInt(countRes.rows[0].count);

  const ids = new Set<string>();
  for (const e of events.rows) {
    collectIds(e.entity_id, ids);
    collectIds(e.before_values, ids);
    collectIds(e.after_values, ids);
  }
  const refs = await resolveNames(auth.company_id, [...ids]);

  return NextResponse.json({
    events: events.rows,
    refs,
    actors: actors.rows,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  });
}
