import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { alertNotFound, canAccessAlert } from "@/lib/alerts/access";
import { recalculateAlert, getAsOfDate } from "@/lib/scoring/recalculate";
import { addChangeNotes, commentRequired, readChangeComment } from "@/lib/change-notes";

const TARGETS: Record<string, string> = {
  market_access: "Market access",
  cost_to_implement: "Cost to implement",
  urgency: "Urgency",
  total: "Total score",
};

/**
 * POST { target, mode, comment } — step a score back one change at a time.
 *
 * mode "undo" (default): undo the current adjustment for the factor. The adjustment it replaced
 *   comes back; when there was none, the imported (calculated) value applies again. Repeating it
 *   walks back through every change until the imported value — never straight there.
 * mode "restore": no adjustment is active (it was removed) — bring back the one removed last.
 *
 * The step is itself a change: it needs a comment, and is logged in Notes and History.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["company_admin", "manager"].includes(session.membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessAlert({ ...session.membership, membership_id: session.membership.id }, id))) return alertNotFound();

  const body = await request.json().catch(() => ({}));
  const target = String(body.target || "");
  if (!TARGETS[target]) return NextResponse.json({ error: `target must be one of: ${Object.keys(TARGETS).join(", ")}` }, { status: 400 });
  const mode = body.mode === "restore" ? "restore" : "undo";
  const comment = readChangeComment(request, body);
  if (!comment) return commentRequired();
  const companyId = session.membership.company_id;
  const label = TARGETS[target];

  const active = await query(
    `SELECT id, value, replaces_override_id FROM score_overrides
     WHERE alert_id = $1 AND company_id = $2 AND target = $3 AND ended_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [id, companyId, target]
  );
  const current = active.rows[0] ?? null;

  // The adjustment to bring back (null = back to the imported value)
  let bring: { id: string; value: number; reason: string; expires_at: string | null; replaces_override_id: string | null } | null = null;
  if (mode === "undo") {
    if (!current) return NextResponse.json({ error: `${label} already uses the imported value — nothing to undo`, code: "nothing_to_undo" }, { status: 409 });
    if (current.replaces_override_id) {
      const prev = await query(
        `SELECT id, value, reason, expires_at, replaces_override_id FROM score_overrides WHERE id = $1 AND company_id = $2`,
        [current.replaces_override_id, companyId]
      );
      bring = prev.rows[0] ?? null;
    }
  } else {
    if (current) return NextResponse.json({ error: `${label} has an adjustment — undo it instead`, code: "has_adjustment" }, { status: 409 });
    const last = await query(
      `SELECT id, value, reason, expires_at, replaces_override_id FROM score_overrides
       WHERE alert_id = $1 AND company_id = $2 AND target = $3 AND ended_at IS NOT NULL
       ORDER BY ended_at DESC LIMIT 1`,
      [id, companyId, target]
    );
    bring = last.rows[0] ?? null;
    if (!bring) return NextResponse.json({ error: `${label} has no earlier adjustment to restore` }, { status: 409 });
  }

  if (current) {
    await query(`UPDATE score_overrides SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL`, [current.id]);
  }
  if (bring) {
    // A copy, so the timeline stays intact. Undo: it replaces what the original replaced, so the
    // next undo goes one step further back. Restore: before it the imported value applied.
    const stillValid = !bring.expires_at || new Date(bring.expires_at) > new Date();
    await query(
      `INSERT INTO score_overrides (company_id, alert_id, target, value, reason, created_by, expires_at, replaces_override_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [companyId, id, target, bring.value, bring.reason, session.membership.id, stillValid ? bring.expires_at : null, mode === "undo" ? bring.replaces_override_id : null]
    );
  }

  const afterValue = bring ? bring.value : null;
  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values, after_values, reason)
     VALUES ($1, $2, $3, 'alert', $4, $5, $6, $7)`,
    [companyId, session.membership.id, mode === "undo" ? "score_override_reverted" : "score_override_restored", id,
     JSON.stringify({ target, value: current?.value ?? null }), JSON.stringify({ target, value: afterValue }), comment]
  );
  const action = mode === "restore"
    ? `Score adjustment restored: ${label} set back to ${afterValue}`
    : bring
      ? `Score change undone: ${label} back to ${afterValue} (the previous adjustment)`
      : `Score change undone: ${label} back to the imported value`;
  await addChangeNotes(companyId, [id], session.membership.id, action, comment);

  const result = await recalculateAlert(id, companyId, getAsOfDate(session.company.time_zone), mode === "undo" ? "override_reverted" : "override_restored");
  return NextResponse.json({ success: true, value: afterValue, assessment: result });
}
