import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { ALERT_UUID, alertNotFound, canAccessAlert } from "@/lib/alerts/access";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  const { id } = await params;
  const groupCheck = await query(
    `SELECT 1 FROM regulation_groups WHERE id::text = $1 AND company_id = $2 AND state <> 'archived'`,
    [id, auth.company_id]
  );
  if (!groupCheck.rowCount) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const res = await query(
    `SELECT a.id, a.external_alert_id, a.title, a.stage, aap.effective_priority, aap.effective_total,
            CASE WHEN a.primary_group_id = $1 THEN 'primary' ELSE 'related' END as relationship
     FROM alerts a
     LEFT JOIN alert_active_projections aap ON aap.alert_id = a.id AND aap.company_id = a.company_id
     LEFT JOIN alert_group_links agl ON agl.alert_id = a.id AND agl.company_id = a.company_id AND agl.group_id = $1
     WHERE (a.primary_group_id = $1 OR agl.group_id = $1) AND a.company_id = $2 AND a.archived_at IS NULL
     ORDER BY a.title`,
    [id, auth.company_id]
  );

  return NextResponse.json({ alerts: res.rows });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;

  const body = await request.json();
  const { alert_id, relationship = "primary" } = body;
  if (relationship !== "primary" && relationship !== "related") {
    return NextResponse.json({ error: "Invalid relationship" }, { status: 400 });
  }
  if (typeof alert_id !== "string" || !(await canAccessAlert(auth, alert_id))) return alertNotFound();

  const groupCheck = await query(
    `SELECT 1 FROM regulation_groups WHERE id::text = $1 AND company_id = $2 AND state <> 'archived'`,
    [id, auth.company_id]
  );
  if (groupCheck.rows.length === 0) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  if (relationship === "primary") {
    await query(`UPDATE alerts SET primary_group_id = $1, record_version = record_version + 1 WHERE id = $2 AND company_id = $3`, [id, alert_id, auth.company_id]);
  } else {
    await query(
      `INSERT INTO alert_group_links (company_id, alert_id, group_id, relationship, confirmed_by, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (alert_id, group_id) DO UPDATE SET relationship = $4
       WHERE alert_group_links.company_id = $1`,
      [auth.company_id, alert_id, id, relationship, auth.membership_id]
    );
  }

  await createAuditEvent(auth.company_id, auth.membership_id, "link_alert", "regulation_group", id, null, { alert_id, relationship });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;

  const { searchParams } = new URL(request.url);
  const alertId = searchParams.get("alert_id");
  if (!alertId) return NextResponse.json({ error: "alert_id required" }, { status: 400 });
  if (!ALERT_UUID.test(id)) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (!(await canAccessAlert(auth, alertId))) return alertNotFound();

  await query(`UPDATE alerts SET primary_group_id = NULL, record_version = record_version + 1 WHERE id = $1 AND primary_group_id = $2 AND company_id = $3`, [alertId, id, auth.company_id]);
  await query(`DELETE FROM alert_group_links WHERE alert_id = $1 AND group_id = $2 AND company_id = $3`, [alertId, id, auth.company_id]);

  await createAuditEvent(auth.company_id, auth.membership_id, "unlink_alert", "regulation_group", id, { alert_id: alertId }, null);

  return NextResponse.json({ success: true });
}
