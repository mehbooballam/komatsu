import { NextRequest, NextResponse } from "next/server";
import { query, getClient } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, canAssign, createAuditEvent } from "@/lib/auth-helpers";
import { loadGroupTree, checkParent, subtreeIds } from "@/lib/groups";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id } = await params;

  const tree = await loadGroupTree(auth.company_id);
  const group = tree.find((g) => g.id === id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const alertsRes = await query(
    `SELECT a.id, a.external_alert_id, a.title, a.stage, a.primary_group_id AS group_id,
            aap.effective_priority, aap.effective_total, aap.next_compliance_deadline
     FROM alerts a
     LEFT JOIN alert_active_projections aap ON aap.alert_id = a.id
     WHERE a.primary_group_id = ANY($1::uuid[]) AND a.company_id = $2 AND a.archived_at IS NULL
     ORDER BY a.title`,
    [subtreeIds(tree, id), auth.company_id]
  );

  return NextResponse.json({
    group,
    subgroups: tree.filter((g) => g.parent_group_id === id),
    alerts: alertsRes.rows,
  });
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

  const tree = await loadGroupTree(auth.company_id);
  const current = tree.find((g) => g.id === id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Moving under another parent (null = make it a top-level group)
  const moving = Object.prototype.hasOwnProperty.call(body, "parent_group_id");
  const newParent: string | null = moving ? body.parent_group_id || null : current.parent_group_id;
  if (moving) {
    const problem = checkParent(tree, id, newParent);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const { jurisdiction_ref, issuer, description, state } = body;
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  if (title !== undefined && !title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (title && title.length > 120) return NextResponse.json({ error: "Title must be 120 characters or fewer" }, { status: 400 });

  await query(
    `UPDATE regulation_groups SET title = COALESCE($1, title), jurisdiction_ref = COALESCE($2, jurisdiction_ref),
     issuer = COALESCE($3, issuer), description = COALESCE($4, description), state = COALESCE($5, state),
     parent_group_id = $6
     WHERE id = $7 AND company_id = $8`,
    [title ?? null, jurisdiction_ref ?? null, issuer ?? null, description ?? null, state ?? null, newParent, id, auth.company_id]
  );

  await createAuditEvent(auth.company_id, auth.membership_id, "update", "regulation_group", id,
    { title: current.title, parent_group_id: current.parent_group_id },
    { title: title ?? current.title, parent_group_id: newParent });

  const group = (await loadGroupTree(auth.company_id)).find((g) => g.id === id);
  return NextResponse.json({ group });
}

/**
 * Deletes a group and all of its sub-groups (they are archived, so history is kept).
 * Their alerts move up to the deleted group's parent, or become ungrouped at top level.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;

  const tree = await loadGroupTree(auth.company_id);
  const group = tree.find((g) => g.id === id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ids = subtreeIds(tree, id);
  const target = group.parent_group_id;

  const client = await getClient();
  let moved = 0;
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `UPDATE alerts SET primary_group_id = $1
       WHERE company_id = $2 AND primary_group_id = ANY($3::uuid[]) RETURNING id`,
      [target, auth.company_id, ids]
    );
    moved = res.rowCount ?? 0;
    await client.query(`DELETE FROM alert_group_links WHERE company_id = $1 AND group_id = ANY($2::uuid[])`, [auth.company_id, ids]);
    await client.query(
      `UPDATE regulation_groups SET state = 'archived' WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [auth.company_id, ids]
    );
    // Alerts that relied on a deleted group's owner now follow their new group (or none)
    await client.query(
      `UPDATE alert_active_projections p
       SET effective_owner_id = COALESCE(a.direct_owner_membership_id, rg.owner_membership_id), updated_at = NOW()
       FROM alerts a LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       WHERE p.alert_id = a.id AND a.id = ANY($1::uuid[])`,
      [res.rows.map((r) => r.id)]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  await createAuditEvent(auth.company_id, auth.membership_id, "delete", "regulation_group", id,
    { title: group.title, path: group.path, subgroups: ids.length - 1 },
    { alerts_moved_to: target, alerts_moved: moved });

  return NextResponse.json({ success: true, deleted_groups: ids.length, alerts_moved: moved, moved_to: target });
}
