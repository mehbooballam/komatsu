import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized } from "@/lib/auth-helpers";

export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();

  const result = await query(
    `SELECT m.id, m.role, m.access_scope, m.state, m.joined_at,
            up.display_name, up.email
     FROM memberships m
     JOIN user_profiles up ON up.id = m.user_id
     WHERE m.company_id = $1 AND m.state = 'active'
     ORDER BY up.display_name`,
    [auth.company_id]
  );

  return NextResponse.json({ members: result.rows });
}
