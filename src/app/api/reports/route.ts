import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createAuditEvent, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { getWorkspaceDate } from "@/lib/workspace-date";
import { canEditReports, defaultTitle, normalizePeriod } from "@/lib/reports";
import { createGeneratedReport, REPORT_JOINS, REPORT_SELECT } from "@/lib/reports-server";

/**
 * All monthly reports for the workspace, newest month first. The current
 * month's report is generated automatically the first time an editor opens the list.
 */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();

  if (canEditReports(auth.role)) {
    const thisMonth = `${getWorkspaceDate(auth.time_zone).slice(0, 7)}-01`;
    const id = await createGeneratedReport(auth.company_id, auth.time_zone, null, thisMonth);
    if (id) {
      await createAuditEvent(auth.company_id, null, "report_created", "risk_report", id, null, {
        title: defaultTitle(thisMonth), period: thisMonth, generated: true,
      });
    }
  }

  const res = await query(
    `${REPORT_SELECT} ${REPORT_JOINS}
     WHERE r.company_id = $1
     ORDER BY r.period DESC`,
    [auth.company_id]
  );
  return NextResponse.json({ reports: res.rows, can_edit: canEditReports(auth.role) });
}

/** POST { period: "2026-10" } — generates the report for another month (e.g. a past one). */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEditReports(auth.role)) return forbidden();

  const body = await request.json().catch(() => ({}));
  const period = normalizePeriod(body.period);
  if (!period) return NextResponse.json({ error: "Choose a valid month" }, { status: 400 });

  const id = await createGeneratedReport(auth.company_id, auth.time_zone, auth.membership_id, period);
  if (!id) {
    const existing = await query(`SELECT id FROM risk_reports WHERE company_id = $1 AND period = $2`, [auth.company_id, period]);
    return NextResponse.json({ error: "A report for that month already exists", id: existing.rows[0]?.id }, { status: 409 });
  }
  await createAuditEvent(auth.company_id, auth.membership_id, "report_created", "risk_report", id, null, {
    title: defaultTitle(period), period, generated: true,
  });
  return NextResponse.json({ id }, { status: 201 });
}
