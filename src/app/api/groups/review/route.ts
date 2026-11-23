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

/**
 * POST { alert_ids: string[] (or alert_id), decision: "confirm" | "reject", comment }
 * Confirms or rejects one or more suggested groupings. One comment covers them all;
 * it is required to confirm and optional to reject.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope) || !canEdit(auth.role)) return forbidden();

  const body = await request.json().catch(() => ({}));
  const rawIds: unknown[] = Array.isArray(body.alert_ids) ? body.alert_ids : typeof body.alert_id === "string" ? [body.alert_id] : [];
  const ids = [...new Set(rawIds.filter((v): v is string => typeof v === "string" && ALERT_UUID.test(v)))];
  if (!ids.length || ids.length > 1000 || (body.decision !== "confirm" && body.decision !== "reject")) {
    return NextResponse.json({ error: "alert_ids (1–1000) and decision are required" }, { status: 400 });
  }
  const decision: "confirm" | "reject" = body.decision;
  const comment = readChangeComment(request, body);
  if (!comment && decision !== "reject") return commentRequired();

  // Only alerts still waiting for review
  const cur = await query(
    `SELECT id, primary_group_id FROM alerts
     WHERE id = ANY($1::uuid[]) AND company_id = $2 AND grouping_method IN ('similarity', 'ai') AND NOT grouping_reviewed`,
    [ids, auth.company_id]
  );
  if (!cur.rowCount) return NextResponse.json({ error: "Nothing to review for these alerts" }, { status: 404 });
  const rows = cur.rows as Array<{ id: string; primary_group_id: string | null }>;
  const done = rows.map((r) => r.id);
  const paths = new Map((await loadGroupTree(auth.company_id)).map((g) => [g.id, g.path.join(" › ")]));
  const pathOf = (gid: string | null) => (gid && paths.get(gid)) || "its group";

  if (decision === "confirm") {
    await query(`UPDATE alerts SET grouping_reviewed = TRUE WHERE id = ANY($1::uuid[]) AND company_id = $2`, [done, auth.company_id]);
  } else {
    // Rejected: out of the group, and kept out of automatic grouping
    await query(
      `UPDATE alerts SET primary_group_id = NULL, grouping_method = 'manual', grouping_confidence = NULL,
              grouping_basis = $3, grouping_reviewed = TRUE, record_version = record_version + 1
       WHERE id = ANY($1::uuid[]) AND company_id = $2`,
      [done, auth.company_id, comment || "Rejected by reviewer"]
    );
    await query(
      `UPDATE alert_active_projections p
       SET effective_owner_id = a.direct_owner_membership_id, updated_at = NOW()
       FROM alerts a WHERE p.alert_id = a.id AND a.id = ANY($1::uuid[]) AND a.company_id = $2`,
      [done, auth.company_id]
    );
  }

  // Notes and History per alert (each names its own group)
  for (const r of rows) {
    const path = pathOf(r.primary_group_id);
    await addChangeNotes(
      auth.company_id, [r.id], auth.membership_id,
      decision === "confirm" ? `Automatic grouping confirmed: ${path}` : `Automatic grouping rejected: removed from ${path}`,
      comment || (decision === "reject" ? "No reason given" : comment)
    );
    await createAuditEvent(auth.company_id, auth.membership_id, `grouping_${decision}`, "alert", r.id,
      { group_id: r.primary_group_id }, { decision, ...(rows.length > 1 ? { bulk: rows.length } : {}) }, comment || undefined);
  }

  return NextResponse.json({ success: true, count: done.length, skipped: ids.length - done.length });
}
