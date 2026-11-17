import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth } from "@/lib/auth-helpers";
import { setActiveWorkspace } from "@/lib/workspaces";

/** POST /api/workspaces/switch { company_id } — make another of the user's workspaces active. */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { company_id } = (await request.json().catch(() => ({}))) as { company_id?: string };
  if (!company_id) return NextResponse.json({ error: "company_id is required" }, { status: 400 });

  const member = await query(
    `SELECT 1 FROM memberships m JOIN companies c ON c.id = m.company_id
     WHERE m.user_id = $1 AND m.company_id = $2 AND m.state = 'active' AND c.archived_at IS NULL`,
    [auth.user_id, company_id]
  );
  if (member.rows.length === 0) {
    return NextResponse.json({ error: "You are not a member of that workspace" }, { status: 403 });
  }

  await setActiveWorkspace(company_id);
  return NextResponse.json({ success: true });
}
