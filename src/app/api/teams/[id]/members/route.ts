import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/auth/middleware";
import { canManageTeams } from "@/lib/auth/permissions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageTeams(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const result = await query(
      `SELECT tm.id, tm.membership_id, up.display_name, up.email, m.role
       FROM team_memberships tm
       JOIN teams t ON t.id = tm.team_id AND t.company_id = tm.company_id AND t.archived_at IS NULL
       JOIN memberships m ON m.id = tm.membership_id AND m.company_id = tm.company_id AND m.state = 'active'
       JOIN user_profiles up ON up.id = m.user_id
       WHERE tm.team_id = $1 AND tm.company_id = $2
       ORDER BY up.display_name`,
      [id, session.company.id]
    );

    return NextResponse.json({ members: result.rows });
  } catch (error: unknown) {
    console.error("List team members error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageTeams(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { membershipId } = await request.json();

    if (!membershipId) {
      return NextResponse.json(
        { error: "Membership ID is required" },
        { status: 400 }
      );
    }

    const team = await query(`SELECT 1 FROM teams WHERE id::text = $1 AND company_id = $2 AND archived_at IS NULL`, [id, session.company.id]);
    if (!team.rowCount) return NextResponse.json({ error: "Team not found" }, { status: 404 });

    // Verify membership belongs to same company
    const memberCheck = await query(
      `SELECT id FROM memberships WHERE id = $1 AND company_id = $2 AND state = 'active'`,
      [membershipId, session.company.id]
    );
    if (memberCheck.rows.length === 0) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    await query(
      `INSERT INTO team_memberships (company_id, team_id, membership_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [session.company.id, id, membershipId]
    );

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error: unknown) {
    console.error("Add team member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageTeams(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const url = new URL(request.url);
    const membershipId = url.searchParams.get("membershipId");

    if (!membershipId) {
      return NextResponse.json(
        { error: "Membership ID is required" },
        { status: 400 }
      );
    }

    await query(
      `DELETE FROM team_memberships WHERE team_id = $1 AND membership_id = $2 AND company_id = $3`,
      [id, membershipId, session.company.id]
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Remove team member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
