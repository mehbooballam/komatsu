import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { aiFeatures, loadAiSettings } from "@/lib/ai/settings";
import { ProviderError } from "@/lib/ai/providers";
import { startAiGrouping } from "@/lib/grouping/ai";
import { PROVIDER_INFO } from "@/lib/ai/provider-info";

// Imports and AI grouping runs (which continue after the response) can take minutes
export const maxDuration = 300;

/** GET — whether AI grouping is ready, and the latest runs. */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  const s = await loadAiSettings(auth.company_id);
  const runs = await query(
    `SELECT r.id, r.status, r.mode, r.scope, r.trigger, r.provider, r.model, r.progress, r.usage, r.error, r.result,
            r.created_at, r.finished_at, r.applied_at,
            jsonb_array_length(COALESCE(r.proposal->'groups', '[]')) AS proposed_groups,
            jsonb_array_length(COALESCE(r.proposal->'assignments', '[]')) AS proposed_assignments,
            up.display_name AS created_by_name
     FROM ai_grouping_runs r
     LEFT JOIN memberships m ON m.id = r.created_by
     LEFT JOIN user_profiles up ON up.id = m.user_id
     WHERE r.company_id = $1 ORDER BY r.created_at DESC LIMIT 10`,
    [auth.company_id]
  );
  return NextResponse.json({
    ready: aiFeatures(s).grouping,
    enabled: s.enabled,
    provider: PROVIDER_INFO[s.provider].label,
    model: s.model,
    can_run: canEdit(auth.role),
    runs: runs.rows,
  });
}

/** POST { scope: "ungrouped" | "all_automatic" } — start a run; it stops at a proposal for review. */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope) || !canEdit(auth.role)) return forbidden();
  const body = await request.json().catch(() => ({}));
  const scope = body.scope === "all_automatic" ? "all_automatic" : "ungrouped";
  try {
    const r = await startAiGrouping(auth.company_id, { mode: "review", scope, trigger: "manual", membershipId: auth.membership_id });
    return NextResponse.json(r, { status: r.alreadyRunning ? 200 : 202 });
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("Could not start AI grouping");
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
