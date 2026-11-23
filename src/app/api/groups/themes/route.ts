import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { commentRequired, readChangeComment } from "@/lib/change-notes";
import { groupByTheme, refreshThemes } from "@/lib/grouping/themes";

/** GET — alerts without a group, counted by theme (what "Group by theme" would do). */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  await refreshThemes(auth.company_id);
  const res = await query(
    `SELECT theme, COUNT(*)::int AS alerts FROM alerts
     WHERE company_id = $1 AND archived_at IS NULL AND primary_group_id IS NULL AND grouping_method IS DISTINCT FROM 'manual'
     GROUP BY theme ORDER BY COUNT(*) DESC, theme`,
    [auth.company_id]
  );
  return NextResponse.json({
    themes: res.rows.filter((r) => r.theme),
    no_theme: res.rows.find((r) => !r.theme)?.alerts ?? 0,
  });
}

/** POST { alert_ids?: string[], comment } — put alerts without a group into their theme group. */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope) || !canEdit(auth.role)) return forbidden();
  const body = await request.json().catch(() => ({}));
  const comment = readChangeComment(request, body);
  if (!comment) return commentRequired();
  const ids = Array.isArray(body.alert_ids)
    ? body.alert_ids.filter((x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5000)
    : null;
  const result = await groupByTheme(auth.company_id, { alertIds: ids, membershipId: auth.membership_id, comment });
  return NextResponse.json({ result });
}
