import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { ALERT_UUID } from "@/lib/alerts/access";
import { loadGroupTree } from "@/lib/groups";
import { addChangeNotes, commentRequired, readChangeComment } from "@/lib/change-notes";

/** GET — alerts grouped by subject similarity (Step 3) that nobody has confirmed yet. */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();

  const [res, tree] = await Promise.all([
    query(
      `SELECT a.id, a.title, a.external_alert_id, a.primary_group_id AS group_id, a.grouping_confidence AS confidence,
              a.grouping_basis AS basis, p.effective_priority AS priority
       FROM alerts a
       LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
       WHERE a.company_id = $1 AND a.archived_at IS NULL AND a.grouping_method IN ('similarity', 'ai') AND NOT a.grouping_reviewed
       ORDER BY a.grouping_confidence ASC, a.title`,
      [auth.company_id]
    ),
    loadGroupTree(auth.company_id),
  ]);
  const paths = new Map(tree.map((g) => [g.id, g.path]));
  return NextResponse.json({
    items: res.rows.map((r) => ({ ...r, group_path: r.group_id ? paths.get(r.group_id) ?? [] : [] })),
  });
}

/** POST { alert_id, decision: "confirm" | "reject", comment } */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope) || !canEdit(auth.role)) return forbidden();

  const body = await request.json().catch(() => ({}));
  const alertId = typeof body.alert_id === "string" && ALERT_UUID.test(body.alert_id) ? body.alert_id : null;
  if (!alertId || (body.decision !== "confirm" && body.decision !== "reject")) {
    return NextResponse.json({ error: "alert_id and decision are required" }, { status: 400 });
  }
  const comment = readChangeComment(request, body);
  if (!comment) return commentRequired();

  const cur = await query(
    `SELECT primary_group_id FROM alerts WHERE id = $1 AND company_id = $2 AND grouping_method IN ('similarity', 'ai') AND NOT grouping_reviewed`,
    [alertId, auth.company_id]
  );
  if (!cur.rowCount) return NextResponse.json({ error: "Nothing to review for this alert" }, { status: 404 });
  const groupId = cur.rows[0].primary_group_id;
  const path = (await loadGroupTree(auth.company_id)).find((g) => g.id === groupId)?.path.join(" › ") ?? "its group";

  if (body.decision === "confirm") {
    await query(`UPDATE alerts SET grouping_reviewed = TRUE WHERE id = $1 AND company_id = $2`, [alertId, auth.company_id]);
    await addChangeNotes(auth.company_id, [alertId], auth.membership_id, `Automatic grouping confirmed: ${path}`, comment);
  } else {
    // Rejected: out of the group, and kept out of automatic grouping
    await query(
      `UPDATE alerts SET primary_group_id = NULL, grouping_method = 'manual', grouping_confidence = NULL,
              grouping_basis = $3, grouping_reviewed = TRUE, record_version = record_version + 1
       WHERE id = $1 AND company_id = $2`,
      [alertId, auth.company_id, comment]
    );
    await query(
      `UPDATE alert_active_projections p
       SET effective_owner_id = a.direct_owner_membership_id, updated_at = NOW()
       FROM alerts a WHERE p.alert_id = a.id AND a.id = $1`,
      [alertId]
    );
    await addChangeNotes(auth.company_id, [alertId], auth.membership_id, `Automatic grouping rejected: removed from ${path}`, comment);
  }
  await createAuditEvent(auth.company_id, auth.membership_id, `grouping_${body.decision}`, "alert", alertId,
    { group_id: groupId }, { decision: body.decision }, comment);

  return NextResponse.json({ success: true });
}
