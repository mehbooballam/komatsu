import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, password, displayName } = body;

    if (!token) {
      return NextResponse.json(
        { error: "Invitation token is required" },
        { status: 400 }
      );
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const invResult = await query(
      `SELECT id, company_id, email, role, scope, team_ids
       FROM invitations
       WHERE token_hash = $1 AND state = 'pending' AND expires_at > now()`,
      [tokenHash]
    );

    if (invResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid or expired invitation" },
        { status: 400 }
      );
    }

    const invitation = invResult.rows[0];

    // Check if user already exists
    const existingUser = await query(
      `SELECT id, email, verified_email FROM user_profiles WHERE LOWER(email) = $1`,
      [invitation.email.toLowerCase()]
    );

    let userId: string;

    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;

      // Check they don't already have a membership
      const existingMembership = await query(
        `SELECT id FROM memberships WHERE company_id = $1 AND user_id = $2 AND state = 'active'`,
        [invitation.company_id, userId]
      );
      if (existingMembership.rows.length > 0) {
        return NextResponse.json(
          { error: "You are already a member of this workspace" },
          { status: 409 }
        );
      }
    } else {
      // New user needs password and display name
      if (!password || !displayName) {
        return NextResponse.json(
          { error: "Password and display name are required for new accounts" },
          { status: 400 }
        );
      }

      const pwError = validatePasswordStrength(password);
      if (pwError) {
        return NextResponse.json({ error: pwError }, { status: 400 });
      }

      const passwordHash = await hashPassword(password);
      const userResult = await query(
        `INSERT INTO user_profiles (email, password_hash, display_name, verified_email)
         VALUES ($1, $2, $3, TRUE)
         RETURNING id`,
        [invitation.email.toLowerCase(), passwordHash, displayName.trim()]
      );
      userId = userResult.rows[0].id;
    }

    // Create membership
    const membershipResult = await query(
      `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id`,
      [invitation.company_id, userId, invitation.role, invitation.scope]
    );

    // Add to teams if specified
    const teamIds = invitation.team_ids || [];
    for (const teamId of teamIds) {
      await query(
        `INSERT INTO team_memberships (company_id, team_id, membership_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [invitation.company_id, teamId, membershipResult.rows[0].id]
      );
    }

    // Mark invitation as accepted
    await query(
      `UPDATE invitations SET state = 'accepted', used_at = now() WHERE id = $1`,
      [invitation.id]
    );

    // Audit
    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
       VALUES ($1, $2, 'invitation.accepted', 'invitation', $3, $4)`,
      [
        invitation.company_id,
        membershipResult.rows[0].id,
        invitation.id,
        JSON.stringify({ email: invitation.email, role: invitation.role }),
      ]
    );

    await createSession(userId, invitation.company_id);

    return NextResponse.json(
      {
        message: "Invitation accepted",
        membership: {
          id: membershipResult.rows[0].id,
          companyId: invitation.company_id,
          role: invitation.role,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Accept invite error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
