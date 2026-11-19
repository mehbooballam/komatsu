import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canAssign, createAuditEvent } from "@/lib/auth-helpers";
import { addChangeNotes, commentRequired, readChangeComment } from "@/lib/change-notes";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canAssign(auth.role)) return forbidden();
  const { id } = await params;

  const body = await request.json();
  const { membership_id, use_group_owner } = body;
  const comment = readChangeComment(request, body);
  if (!comment) return commentRequired();

  const alertRes = await query(
    `SELECT a.id, a.direct_owner_membership_id, a.primary_group_id, a.record_version,
            rg.owner_membership_id as group_owner_id
     FROM alerts a
     LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
     WHERE a.id = $1 AND a.company_id = $2`,
    [id, auth.company_id]
  );
  if (alertRes.rows.length === 0) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

  const alert = alertRes.rows[0];
  const beforeOwner = alert.direct_owner_membership_id;
  let newDirectOwner: string | null;
  let origin: string;

  if (use_group_owner) {
    newDirectOwner = null;
    origin = "group";
  } else if (membership_id) {
    const memberCheck = await query(
      `SELECT id FROM memberships WHERE id = $1 AND company_id = $2 AND state = 'active'`,
      [membership_id, auth.company_id]
    );
    if (memberCheck.rows.length === 0) return NextResponse.json({ error: "Member not found" }, { status: 400 });
    newDirectOwner = membership_id;
    origin = "direct";
  } else {
    newDirectOwner = null;
    origin = "direct";
  }

  await query(
    `UPDATE alerts SET direct_owner_membership_id = $1, record_version = record_version + 1
     WHERE id = $2 AND company_id = $3`,
    [newDirectOwner, id, auth.company_id]
  );

  const effectiveOwner = newDirectOwner || alert.group_owner_id || null;

  await query(
    `INSERT INTO alert_active_projections (company_id, alert_id, effective_owner_id, version, updated_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (company_id, alert_id) DO UPDATE SET effective_owner_id = $3, version = alert_active_projections.version + 1, updated_at = now()`,
    [auth.company_id, id, effectiveOwner]
  );

  await query(
    `INSERT INTO assignment_events (company_id, alert_id, before_owner_id, after_owner_id, origin, cause, actor_membership_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auth.company_id, id, beforeOwner, newDirectOwner, origin, use_group_owner ? "Cleared direct to use group owner" : "Direct assignment", auth.membership_id]
  );

  await createAuditEvent(auth.company_id, auth.membership_id, "assign_owner", "alert", id,
    { owner: beforeOwner }, { owner: newDirectOwner, effective: effectiveOwner, origin }, comment);

  const nameRes = newDirectOwner
    ? await query(
        `SELECT up.display_name FROM memberships m JOIN user_profiles up ON up.id = m.user_id WHERE m.id = $1`,
        [newDirectOwner]
      )
    : null;
  const action = use_group_owner
    ? "Owner set to follow the group owner"
    : newDirectOwner
      ? `Owner assigned: ${nameRes?.rows[0]?.display_name ?? "a team member"}`
      : "Owner removed";
  await addChangeNotes(auth.company_id, [id], auth.membership_id, action, comment);

  return NextResponse.json({ success: true, effective_owner_id: effectiveOwner });
}
