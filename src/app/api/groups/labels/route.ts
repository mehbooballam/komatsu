import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { GROUP_LABEL_COLORS, ensureDefaultLabels } from "@/lib/groups";

/** GET — the workspace's group labels (Federal and State to start with). */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  return NextResponse.json({ labels: await ensureDefaultLabels(auth.company_id) });
}

/** POST { name, color? } — add a label anyone can then put on groups. */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope) || !canEdit(auth.role)) return forbidden();
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 40) return NextResponse.json({ error: "Label names are 1–40 characters" }, { status: 400 });
  const color = GROUP_LABEL_COLORS.includes(body.color) ? body.color : "slate";
  const existing = await query(`SELECT id, name, color FROM group_labels WHERE company_id = $1 AND lower(name) = lower($2)`, [auth.company_id, name]);
  if (existing.rowCount) return NextResponse.json({ label: existing.rows[0] });
  const res = await query(
    `INSERT INTO group_labels (company_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color`,
    [auth.company_id, name, color]
  );
  await createAuditEvent(auth.company_id, auth.membership_id, "create", "group_label", res.rows[0].id, null, { name, color });
  return NextResponse.json({ label: res.rows[0] }, { status: 201 });
}

/** DELETE ?id=… — remove a label from the list and from every group (admins and managers). */
export async function DELETE(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (auth.role !== "company_admin" && auth.role !== "manager") return forbidden();
  const id = request.nextUrl.searchParams.get("id") || "";
  const res = await query(`DELETE FROM group_labels WHERE id::text = $1 AND company_id = $2 RETURNING name`, [id, auth.company_id]);
  if (!res.rowCount) return NextResponse.json({ error: "Label not found" }, { status: 404 });
  await query(
    `UPDATE regulation_groups SET labels = array_remove(labels, $1) WHERE company_id = $2 AND $1 = ANY(labels)`,
    [res.rows[0].name, auth.company_id]
  );
  await createAuditEvent(auth.company_id, auth.membership_id, "delete", "group_label", id, { name: res.rows[0].name }, null);
  return NextResponse.json({ success: true });
}
