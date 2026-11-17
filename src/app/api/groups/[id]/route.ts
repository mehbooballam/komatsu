import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, canAssign, createAuditEvent } from "@/lib/auth-helpers";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id } = await params;

  const groupRes = await query(
    `SELECT rg.*, up.display_name as owner_name
     FROM regulation_groups rg
     LEFT JOIN memberships m ON m.id = rg.owner_membership_id
     LEFT JOIN user_profiles up ON up.id = m.user_id
     WHERE rg.id = $1 AND rg.company_id = $2`,
    [id, auth.company_id]
  );
  if (groupRes.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const alertsRes = await query(
    `SELECT a.id, a.external_alert_id, a.title, a.stage, aap.effective_priority, aap.effective_total, aap.next_compliance_deadline
     FROM alerts a
     LEFT JOIN alert_active_projections aap ON aap.alert_id = a.id
     WHERE a.primary_group_id = $1 AND a.company_id = $2 AND a.archived_at IS NULL
     ORDER BY a.title`,
    [id, auth.company_id]
  );

  return NextResponse.json({ group: groupRes.rows[0], alerts: alertsRes.rows });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;

  const body = await request.json();

  if (body.action === "assign_owner") {
    if (!canAssign(auth.role)) return forbidden();
    const before = await query(`SELECT owner_membership_id FROM regulation_groups WHERE id = $1 AND company_id = $2`, [id, auth.company_id]);
    if (before.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await query(`UPDATE regulation_groups SET owner_membership_id = $1 WHERE id = $2 AND company_id = $3`, [body.membership_id || null, id, auth.company_id]);

    await query(
      `INSERT INTO assignment_events (company_id, group_id, before_owner_id, after_owner_id, origin, cause, actor_membership_id)
       VALUES ($1, $2, $3, $4, 'direct', $5, $6)`,
      [auth.company_id, id, before.rows[0].owner_membership_id, body.membership_id || null, "Group owner assignment", auth.membership_id]
    );

    await createAuditEvent(auth.company_id, auth.membership_id, "assign_owner", "regulation_group", id,
      { owner: before.rows[0].owner_membership_id }, { owner: body.membership_id });

    return NextResponse.json({ success: true });
  }

  const { title, jurisdiction_ref, issuer, description, state } = body;
  const res = await query(
    `UPDATE regulation_groups SET title = COALESCE($1, title), jurisdiction_ref = COALESCE($2, jurisdiction_ref),
     issuer = COALESCE($3, issuer), description = COALESCE($4, description), state = COALESCE($5, state)
     WHERE id = $6 AND company_id = $7 RETURNING *`,
    [title, jurisdiction_ref, issuer, description, state, id, auth.company_id]
  );
  if (res.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ group: res.rows[0] });
}
