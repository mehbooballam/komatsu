import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { alertNotFound, canAccessAlert } from "@/lib/alerts/access";
import { addChangeNotes, commentRequired, readChangeComment } from "@/lib/change-notes";
import { normalizeConfidence } from "@/lib/scoring/confidence";

const FACTORS: Record<string, string> = {
  market_access: "Market access",
  cost_to_implement: "Cost to implement",
  human_resources: "Human resources",
  urgency: "Urgency",
};

/**
 * PUT { factor_key, confidence, comment }
 * Sets a person's confidence for one factor (wins over the imported value).
 * confidence null → remove it, so the imported confidence applies again.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  if (!(await canAccessAlert(auth, id))) return alertNotFound();

  const body = await request.json().catch(() => ({}));
  const comment = readChangeComment(request, body);
  if (!comment) return commentRequired();
  const factor = String(body.factor_key || "");
  if (!FACTORS[factor]) return NextResponse.json({ error: "Unknown factor" }, { status: 400 });
  const value = body.confidence == null ? null : normalizeConfidence(body.confidence);
  if (body.confidence != null && !value) return NextResponse.json({ error: "Enter a confidence" }, { status: 400 });

  const before = await query(
    `SELECT confidence FROM alert_factor_confidence WHERE alert_id = $1 AND factor_key = $2 AND company_id = $3`,
    [id, factor, auth.company_id]
  );
  const prev: string | null = before.rows[0]?.confidence ?? null;

  if (value) {
    await query(
      `INSERT INTO alert_factor_confidence (company_id, alert_id, factor_key, confidence, set_by, set_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (alert_id, factor_key) DO UPDATE SET confidence = EXCLUDED.confidence, set_by = EXCLUDED.set_by, set_at = now()`,
      [auth.company_id, id, factor, value, auth.membership_id]
    );
  } else {
    await query(`DELETE FROM alert_factor_confidence WHERE alert_id = $1 AND factor_key = $2 AND company_id = $3`, [id, factor, auth.company_id]);
  }

  const action = value
    ? `${FACTORS[factor]} confidence set to ${value}`
    : `${FACTORS[factor]} confidence reset to the imported value`;
  await addChangeNotes(auth.company_id, [id], auth.membership_id, action, comment);
  await createAuditEvent(
    auth.company_id,
    auth.membership_id,
    "factor_confidence_set",
    "alert",
    id,
    { factor_key: factor, confidence: prev },
    { factor_key: factor, confidence: value, ...(body.revert === true ? { reverted_change: true } : {}) },
    comment
  );
  return NextResponse.json({ ok: true, confidence: value });
}
