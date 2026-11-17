import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";

export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();

  const res = await query(
    `SELECT rg.*,
            up.display_name as owner_name,
            (SELECT COUNT(*) FROM alerts a WHERE a.primary_group_id = rg.id AND a.archived_at IS NULL) as alert_count,
            (SELECT aap.effective_priority FROM alerts a
             JOIN alert_active_projections aap ON aap.alert_id = a.id
             WHERE a.primary_group_id = rg.id AND a.archived_at IS NULL
             ORDER BY CASE aap.effective_priority
               WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 WHEN 'low' THEN 4 ELSE 5 END
             LIMIT 1) as highest_priority
     FROM regulation_groups rg
     LEFT JOIN memberships m ON m.id = rg.owner_membership_id
     LEFT JOIN user_profiles up ON up.id = m.user_id
     WHERE rg.company_id = $1 AND rg.state != 'archived'
     ORDER BY rg.title`,
    [auth.company_id]
  );

  return NextResponse.json({ groups: res.rows });
}

export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();

  const body = await request.json();
  const { title, jurisdiction_ref, issuer, description, parent_group_id } = body;

  if (!title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  if (parent_group_id) {
    const parentCheck = await query(
      `SELECT id FROM regulation_groups WHERE id = $1 AND company_id = $2`,
      [parent_group_id, auth.company_id]
    );
    if (parentCheck.rows.length === 0) {
      return NextResponse.json({ error: "Parent group not found" }, { status: 400 });
    }
  }

  const res = await query(
    `INSERT INTO regulation_groups (company_id, title, jurisdiction_ref, issuer, description, parent_group_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [auth.company_id, title.trim(), jurisdiction_ref || null, issuer || null, description || null, parent_group_id || null]
  );

  await createAuditEvent(auth.company_id, auth.membership_id, "create", "regulation_group", res.rows[0].id, null, { title });

  return NextResponse.json({ group: res.rows[0] }, { status: 201 });
}
