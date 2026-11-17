import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { recalculateAlert, recalculateCompanyAlerts, getAsOfDate } from "@/lib/scoring/recalculate";

export async function POST(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.membership.role !== "company_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const asOfDate = getAsOfDate(session.company.time_zone);

  if (body.alert_id) {
    const result = await recalculateAlert(body.alert_id, session.membership.company_id, asOfDate, "manual");
    return NextResponse.json({ success: true, result });
  }

  const result = await recalculateCompanyAlerts(session.membership.company_id, asOfDate, "manual");
  return NextResponse.json({ success: true, ...result });
}
