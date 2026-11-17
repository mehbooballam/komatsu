import { NextRequest, NextResponse } from "next/server";
import { getAuth, createAuditEvent } from "@/lib/auth-helpers";
import { deleteAlerts } from "@/lib/alerts/delete";

/**
 * POST /api/alerts/delete
 *   { ids: string[] }                                   delete selected alerts (admin or manager)
 *   { all: true, confirm: "DELETE", include_imports? }  delete every alert in the workspace (admin only)
 */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { ids, all, confirm, include_imports } = body as {
    ids?: string[];
    all?: boolean;
    confirm?: string;
    include_imports?: boolean;
  };

  if (all) {
    if (auth.role !== "company_admin") {
      return NextResponse.json({ error: "Only administrators can delete all alerts" }, { status: 403 });
    }
    if (confirm !== "DELETE") {
      return NextResponse.json({ error: 'Type DELETE to confirm' }, { status: 400 });
    }
    const deleted = await deleteAlerts(auth.company_id, null, { includeImports: !!include_imports });
    await createAuditEvent(auth.company_id, auth.membership_id, "alerts_deleted_all", "company", auth.company_id, null, {
      deleted,
      include_imports: !!include_imports,
    });
    return NextResponse.json({ success: true, deleted });
  }

  if (!["company_admin", "manager"].includes(auth.role)) {
    return NextResponse.json({ error: "Only administrators and managers can delete alerts" }, { status: 403 });
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No alerts selected" }, { status: 400 });
  }
  const valid = ids.filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
  const deleted = await deleteAlerts(auth.company_id, valid);
  await createAuditEvent(auth.company_id, auth.membership_id, "alerts_deleted", "company", auth.company_id, null, {
    deleted,
    alert_ids: valid,
  });
  return NextResponse.json({ success: true, deleted });
}
