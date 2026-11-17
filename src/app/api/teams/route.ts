import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/auth/middleware";
import { canManageTeams } from "@/lib/auth/permissions";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageTeams(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await query(
      `SELECT t.id, t.name, t.created_at, t.archived_at,
              COUNT(tm.id)::int as member_count
       FROM teams t
       LEFT JOIN team_memberships tm ON tm.team_id = t.id AND tm.company_id = t.company_id
       WHERE t.company_id = $1 AND t.archived_at IS NULL
       GROUP BY t.id
       ORDER BY t.name`,
      [session.company.id]
    );

    return NextResponse.json({ teams: result.rows });
  } catch (error: unknown) {
    console.error("List teams error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageTeams(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Team name is required" },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO teams (company_id, name) VALUES ($1, $2)
       RETURNING id, name, created_at`,
      [session.company.id, name.trim()]
    );

    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
       VALUES ($1, $2, 'team.created', 'team', $3, $4)`,
      [
        session.company.id,
        session.membership.id,
        result.rows[0].id,
        JSON.stringify({ name: name.trim() }),
      ]
    );

    return NextResponse.json({ team: result.rows[0] }, { status: 201 });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "A team with this name already exists" },
        { status: 409 }
      );
    }
    console.error("Create team error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
