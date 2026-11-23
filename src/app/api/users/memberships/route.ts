import { connection, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { validateSession } from "@/lib/auth/session";

export async function GET() {
  await connection();
  try {
    const session = await validateSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await query(
      `SELECT m.id, m.company_id, m.role, m.access_scope, m.state, m.joined_at,
              c.name as company_name, c.slug as company_slug
       FROM memberships m
       JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = $1 AND m.state = 'active' AND c.archived_at IS NULL
       ORDER BY m.joined_at ASC`,
      [session.userId]
    );

    return NextResponse.json({ memberships: result.rows });
  } catch (error: unknown) {
    console.error("List memberships error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
