import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, createAuditEvent } from "@/lib/auth-helpers";
import { isValidWorkspaceTimeZone } from "@/lib/workspace-date";
import { DELETE_KINDS, DELETE_SETTING_KEY } from "@/lib/delete-settings";

/**
 * PATCH /api/workspaces/current { name?, time_zone?, allow_delete?: { alerts?, groups?, products? } }
 * Update the active workspace (admins only). allow_delete switches deleting on or off per type.
 */
export async function PATCH(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "company_admin") {
    return NextResponse.json({ error: "Only administrators can change workspace settings" }, { status: 403 });
  }

  const { name, time_zone, allow_delete } = (await request.json().catch(() => null)) ?? {};
  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) {
    if (typeof name !== "string") return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    const n = name.trim();
    if (n.length < 2 || n.length > 120) return NextResponse.json({ error: "Name must be 2–120 characters" }, { status: 400 });
    values.push(n);
    updates.push(`name = $${values.length}`);
  }
  if (time_zone !== undefined) {
    if (!isValidWorkspaceTimeZone(time_zone)) {
      return NextResponse.json({ error: "Unknown time zone" }, { status: 400 });
    }
    values.push(time_zone);
    updates.push(`time_zone = $${values.length}`);
  }
  let deleteChanges: Record<string, boolean> | null = null;
  if (allow_delete !== undefined) {
    if (!allow_delete || typeof allow_delete !== "object" || Array.isArray(allow_delete)) {
      return NextResponse.json({ error: "allow_delete must list alerts, groups or products as true or false" }, { status: 400 });
    }
    deleteChanges = {};
    for (const [kind, on] of Object.entries(allow_delete as Record<string, unknown>)) {
      if (!(DELETE_KINDS as string[]).includes(kind) || typeof on !== "boolean") {
        return NextResponse.json({ error: "allow_delete must list alerts, groups or products as true or false" }, { status: 400 });
      }
      deleteChanges[DELETE_SETTING_KEY[kind as keyof typeof DELETE_SETTING_KEY]] = on;
    }
    if (!Object.keys(deleteChanges).length) deleteChanges = null;
    else {
      values.push(JSON.stringify(deleteChanges));
      updates.push(`settings = COALESCE(settings, '{}'::jsonb) || $${values.length}::jsonb`);
    }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  const before = deleteChanges
    ? (await query(`SELECT settings FROM companies WHERE id = $1`, [auth.company_id])).rows[0]?.settings ?? {}
    : {};

  values.push(auth.company_id);
  const res = await query(
    `UPDATE companies SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, name, slug, time_zone, settings`,
    values
  );
  if (name !== undefined || time_zone !== undefined) {
    await createAuditEvent(auth.company_id, auth.membership_id, "workspace_updated", "company", auth.company_id, null, { name, time_zone });
  }
  if (deleteChanges) {
    const was = Object.fromEntries(Object.keys(deleteChanges).map((k) => [k, (before as Record<string, unknown>)[k] === true]));
    await createAuditEvent(auth.company_id, auth.membership_id, "delete_settings_updated", "company", auth.company_id, was, deleteChanges);
  }
  return NextResponse.json({ company: res.rows[0] });
}
