import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { loadGroupTree, checkParent, parseGroupFields, rememberLabels, MAX_GROUP_DEPTH } from "@/lib/groups";
import { groupProducts } from "@/lib/products";

/**
 * All active groups, flat and in tree order, with depth, path and roll-up counts.
 * ?alerts=1 also returns every grouped alert (the versions filed directly in each group).
 */
export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  const withAlerts = request.nextUrl.searchParams.get("alerts") === "1";
  const [groups, products, alerts] = await Promise.all([
    loadGroupTree(auth.company_id),
    groupProducts(auth.company_id),
    withAlerts
      ? query(
          `SELECT a.id, a.primary_group_id AS group_id, a.title, a.external_alert_id, a.version_type, a.stage,
                  a.grouping_method, a.grouping_confidence, a.grouping_reviewed, a.jurisdiction_raw,
                  p.effective_priority AS priority, p.effective_total AS score,
                  to_char(p.next_compliance_deadline, 'YYYY-MM-DD') AS deadline
           FROM alerts a
           LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
           WHERE a.company_id = $1 AND a.archived_at IS NULL AND a.primary_group_id IS NOT NULL
           ORDER BY p.effective_total DESC NULLS LAST, a.title`,
          [auth.company_id]
        )
      : null,
  ]);
  return NextResponse.json({
    groups: groups.map((g) => ({ ...g, products: products.get(g.id) || [] })),
    max_depth: MAX_GROUP_DEPTH,
    ...(alerts ? { alerts: alerts.rows } : {}),
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  if (!canEdit(auth.role)) return forbidden();

  const body = await request.json();
  const { title, jurisdiction_ref, issuer, description } = body;
  const parentId: string | null = body.parent_group_id || null;

  if (!title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (title.trim().length > 120) {
    return NextResponse.json({ error: "Title must be 120 characters or fewer" }, { status: 400 });
  }

  const tree = await loadGroupTree(auth.company_id);
  const problem = checkParent(tree, null, parentId);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const fields = parseGroupFields(body, jurisdiction_ref);
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });

  let res;
  try {
    res = await query(
      `INSERT INTO regulation_groups (company_id, title, jurisdiction_ref, issuer, description, parent_group_id, level, group_key, rule_identifiers, labels)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [auth.company_id, title.trim(), jurisdiction_ref || null, issuer || null, description || null, parentId,
        fields.level, fields.group_key, JSON.stringify(fields.identifiers), fields.labels]
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return NextResponse.json({ error: "Another group already uses that key" }, { status: 409 });
    throw e;
  }

  await rememberLabels(auth.company_id, fields.labels);
  await createAuditEvent(auth.company_id, auth.membership_id, "create", "regulation_group", res.rows[0].id, null, {
    title: title.trim(),
    parent_group_id: parentId,
  });

  const group = (await loadGroupTree(auth.company_id)).find((g) => g.id === res.rows[0].id);
  return NextResponse.json({ group }, { status: 201 });
}
