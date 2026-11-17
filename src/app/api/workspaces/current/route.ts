import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, createAuditEvent } from "@/lib/auth-helpers";

/** PATCH /api/workspaces/current { name?, time_zone? } — update the active workspace (admins only). */
export async function PATCH(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "company_admin") {
    return NextResponse.json({ error: "Only administrators can change workspace settings" }, { status: 403 });
  }

  const { name, time_zone } = (await request.json().catch(() => ({}))) as { name?: string; time_zone?: string };
  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) {
    const n = name.trim();
    if (n.length < 2 || n.length > 120) return NextResponse.json({ error: "Name must be 2–120 characters" }, { status: 400 });
    values.push(n);
    updates.push(`name = $${values.length}`);
  }
  if (time_zone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: time_zone });
    } catch {
      return NextResponse.json({ error: "Unknown time zone" }, { status: 400 });
    }
    values.push(time_zone);
    updates.push(`time_zone = $${values.length}`);
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  values.push(auth.company_id);
  const res = await query(
    `UPDATE companies SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, name, slug, time_zone`,
    values
  );
  await createAuditEvent(auth.company_id, auth.membership_id, "workspace_updated", "company", auth.company_id, null, { name, time_zone });
  return NextResponse.json({ company: res.rows[0] });
}
