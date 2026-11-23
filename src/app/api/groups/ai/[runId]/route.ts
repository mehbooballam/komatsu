import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { ProviderError } from "@/lib/ai/providers";
import { loadAiSettings } from "@/lib/ai/settings";
import { applyAiProposal } from "@/lib/grouping/ai";
import { commentRequired, readChangeComment } from "@/lib/change-notes";

const UUID = /^[0-9a-f-]{36}$/i;

/** GET — one run: progress while running, the full proposal once ready. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  const { runId } = await params;
  if (!UUID.test(runId)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const res = await query(
    `SELECT id, status, mode, scope, trigger, provider, model, progress, proposal, result, usage, error, created_at, finished_at, applied_at
     FROM ai_grouping_runs WHERE id = $1 AND company_id = $2`,
    [runId, auth.company_id]
  );
  if (!res.rows[0]) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const s = await loadAiSettings(auth.company_id);
  // Current theme of each alert left ungrouped (proposals made before themes existed have none)
  const run = res.rows[0];
  const ungrouped: Array<{ alert_id: string; theme?: string | null }> = run.proposal?.ungrouped ?? [];
  if (ungrouped.length) {
    const t = await query(`SELECT id, theme FROM alerts WHERE company_id = $1 AND id = ANY($2::uuid[])`, [auth.company_id, ungrouped.map((u) => u.alert_id)]);
    const themes = new Map(t.rows.map((r) => [r.id, r.theme]));
    for (const u of ungrouped) u.theme = themes.get(u.alert_id) ?? null;
  }
  return NextResponse.json({ run, thresholds: { auto_accept: s.auto_accept_confidence, min: s.min_confidence, theme_fallback: s.theme_fallback } });
}

/**
 * POST { action: "apply", exclude_groups?: string[], exclude_alerts?: string[], comment }
 *      { action: "discard" }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope) || !canEdit(auth.role)) return forbidden();
  const { runId } = await params;
  if (!UUID.test(runId)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  if (body.action === "discard") {
    const r = await query(
      `UPDATE ai_grouping_runs SET status = 'discarded' WHERE id = $1 AND company_id = $2 AND status = 'proposed' RETURNING id`,
      [runId, auth.company_id]
    );
    if (!r.rows[0]) return NextResponse.json({ error: "Only a proposal waiting for review can be discarded" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "apply") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const comment = readChangeComment(request, body);
  if (!comment) return commentRequired();
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5000) : []);
  try {
    const result = await applyAiProposal(auth.company_id, runId, {
      membershipId: auth.membership_id,
      comment,
      excludeGroups: list(body.exclude_groups),
      excludeAlerts: list(body.exclude_alerts),
    });
    return NextResponse.json({ result });
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("Could not apply the proposal");
    if (!(err instanceof ProviderError)) console.error("Applying AI grouping failed:", err);
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
