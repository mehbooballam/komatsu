import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { accessibleAlertIds } from "@/lib/alerts/access";
import { addChangeNotes, commentRequired, readChangeComment } from "@/lib/change-notes";

/**
 * POST { alert_ids: string[], needs_review: boolean, comment }
 * needs_review false → "Mark reviewed" (clears the flag set by the import or a person).
 * needs_review true  → flag the alerts for human review by hand; the comment is the reason.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();

  const body = await request.json().catch(() => ({}));
  const comment = readChangeComment(request, body);
  if (!comment) return commentRequired();
  if (typeof body.needs_review !== "boolean") {
    return NextResponse.json({ error: "needs_review must be true or false" }, { status: 400 });
  }
  const requested: string[] = Array.isArray(body.alert_ids) ? body.alert_ids.filter((x: unknown) => typeof x === "string") : [];
  if (!requested.length) return NextResponse.json({ error: "No alerts given" }, { status: 400 });

  const ids = await accessibleAlertIds(auth, requested.slice(0, 500));
  if (!ids.length) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

  const flag = body.needs_review as boolean;
  // Only touch alerts whose state actually changes
  const res = flag
    ? await query(
        `UPDATE alerts SET human_review_required = TRUE, human_review_reason = $3,
                human_review_flagged_at = now(), human_review_flagged_by = $2,
                human_review_cleared_at = NULL, human_review_cleared_by = NULL
         WHERE id = ANY($1::uuid[]) AND company_id = $4 AND NOT human_review_required AND archived_at IS NULL
         RETURNING id`,
        [ids, auth.membership_id, comment, auth.company_id]
      )
    : await query(
        `UPDATE alerts SET human_review_required = FALSE, human_review_cleared_at = now(), human_review_cleared_by = $2
         WHERE id = ANY($1::uuid[]) AND company_id = $3 AND human_review_required AND archived_at IS NULL
         RETURNING id`,
        [ids, auth.membership_id, auth.company_id]
      );
  const changed: string[] = res.rows.map((r) => r.id);

  if (changed.length) {
    await addChangeNotes(auth.company_id, changed, auth.membership_id, flag ? "Marked Needs review" : "Marked reviewed", comment);
    for (const id of changed) {
      await createAuditEvent(
        auth.company_id,
        auth.membership_id,
        flag ? "human_review_flagged" : "human_review_cleared",
        "alert",
        id,
        { human_review_required: !flag },
        { human_review_required: flag },
        comment
      );
    }
  }

  return NextResponse.json({ changed: changed.length, unchanged: ids.length - changed.length });
}
