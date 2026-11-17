import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/auth/middleware";
import { canInviteUsers } from "@/lib/auth/permissions";
import crypto from "crypto";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await query(
      `SELECT i.id, i.email, i.role, i.scope, i.state, i.expires_at, i.created_at,
              up.display_name as invited_by_name
       FROM invitations i
       LEFT JOIN memberships m ON m.id = i.invited_by
       LEFT JOIN user_profiles up ON up.id = m.user_id
       WHERE i.company_id = $1
       ORDER BY i.created_at DESC`,
      [session.company.id]
    );

    return NextResponse.json({ invitations: result.rows });
  } catch (error: unknown) {
    console.error("List invitations error:", error);
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

    if (!canInviteUsers(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { email, role, scope, teamIds } = await request.json();

    if (!email || !role) {
      return NextResponse.json(
        { error: "Email and role are required" },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase().trim();
    const validRoles = ["company_admin", "manager", "reviewer", "risk_owner"];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Check for existing active invitation
    const existing = await query(
      `SELECT id FROM invitations
       WHERE company_id = $1 AND LOWER(email) = $2 AND state = 'pending'`,
      [session.company.id, emailLower]
    );
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "An invitation is already pending for this email" },
        { status: 409 }
      );
    }

    // Check for existing membership
    const existingMember = await query(
      `SELECT m.id FROM memberships m
       JOIN user_profiles u ON u.id = m.user_id
       WHERE m.company_id = $1 AND LOWER(u.email) = $2 AND m.state = 'active'`,
      [session.company.id, emailLower]
    );
    if (existingMember.rows.length > 0) {
      return NextResponse.json(
        { error: "This user is already a member of this workspace" },
        { status: 409 }
      );
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const result = await query(
      `INSERT INTO invitations (company_id, email, role, scope, team_ids, invited_by, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, role, scope, state, expires_at, created_at`,
      [
        session.company.id,
        emailLower,
        role,
        scope || (role === "risk_owner" ? "assigned" : "company"),
        teamIds || [],
        session.membership.id,
        tokenHash,
        expiresAt.toISOString(),
      ]
    );

    console.log(`[DEV] Invitation token for ${emailLower}: ${token}`);
    console.log(
      `[DEV] Accept URL: ${process.env.NEXTAUTH_URL}/accept-invite?token=${token}`
    );

    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
       VALUES ($1, $2, 'invitation.created', 'invitation', $3, $4)`,
      [
        session.company.id,
        session.membership.id,
        result.rows[0].id,
        JSON.stringify({ email: emailLower, role }),
      ]
    );

    return NextResponse.json(
      { invitation: result.rows[0], token },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Create invitation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
