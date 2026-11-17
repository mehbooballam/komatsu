import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getAccountMailer } from "@/lib/auth/account-email";
import { parseEmailAddress } from "@/lib/auth/email-address";
import { getServerSession } from "@/lib/auth/middleware";
import { canInviteUsers } from "@/lib/auth/permissions";
import { canGrantInvitationRole, isInvitationRole } from "@/lib/auth/invitation-policy";
import { hashToken } from "@/lib/auth/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canInviteUsers(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await query(
      `SELECT i.id, i.email, i.role, i.scope, i.state, i.expires_at, i.created_at,
              up.display_name AS invited_by_name
       FROM invitations i
       LEFT JOIN memberships m ON m.id = i.invited_by AND m.company_id = i.company_id
       LEFT JOIN user_profiles up ON up.id = m.user_id
       WHERE i.company_id = $1
       ORDER BY i.created_at DESC`,
      [session.company.id]
    );
    return NextResponse.json({ invitations: result.rows });
  } catch {
    console.error("Invitations could not be listed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canInviteUsers(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const email = parseEmailAddress(body?.email);
    const role = body?.role;
    if (!email || !isInvitationRole(role)) {
      return NextResponse.json({ error: "A valid email and role are required" }, { status: 400 });
    }
    if (!canGrantInvitationRole(session.membership.role, role)) {
      return NextResponse.json({ error: "You cannot invite users to that role" }, { status: 403 });
    }

    const scope = body?.scope ?? (role === "risk_owner" ? "assigned" : "company");
    if (!["company", "team", "assigned"].includes(scope)) {
      return NextResponse.json({ error: "Invalid access scope" }, { status: 400 });
    }
    const requestedTeams: unknown = body?.teamIds ?? [];
    if (!Array.isArray(requestedTeams) || requestedTeams.length > 100 ||
      requestedTeams.some((id) => typeof id !== "string" || !UUID.test(id))) {
      return NextResponse.json({ error: "Invalid teams" }, { status: 400 });
    }
    const teamIds = [...new Set(requestedTeams.map((id: string) => id.toLowerCase()))];

    const deliver = getAccountMailer();
    if (!deliver) {
      return NextResponse.json({ error: "Invitation email is not configured. Contact support for help." }, { status: 503 });
    }

    const companyId = session.company.id;
    const inviterId = session.membership.id;
    const token = randomBytes(32).toString("hex");
    const result = await transaction(async (client) => {
      // Serialize invitations for the same workspace and recipient.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [companyId, email]);
      const inviter = await client.query<{ role: typeof session.membership.role }>(
        `SELECT m.role FROM memberships m JOIN companies c ON c.id = m.company_id
         WHERE m.id = $1 AND m.company_id = $2 AND m.state = 'active' AND c.archived_at IS NULL
         FOR SHARE OF m, c`,
        [inviterId, companyId]
      );
      if (!inviter.rows[0] || !canGrantInvitationRole(inviter.rows[0].role, role)) {
        return { error: "You cannot invite users to that role", status: 403 } as const;
      }

      const teams = await client.query(
        `SELECT id FROM teams WHERE company_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
        [companyId, teamIds]
      );
      if (teams.rowCount !== teamIds.length) {
        return { error: "Teams must belong to this workspace", status: 400 } as const;
      }

      const existing = await client.query(
        `SELECT id FROM invitations
         WHERE company_id = $1 AND LOWER(email) = $2 AND state = 'pending' AND expires_at > now()`,
        [companyId, email]
      );
      if (existing.rowCount) return { error: "An invitation is already pending for this email", status: 409 } as const;

      const member = await client.query(
        `SELECT m.id FROM memberships m JOIN user_profiles u ON u.id = m.user_id
         WHERE m.company_id = $1 AND LOWER(u.email) = $2`,
        [companyId, email]
      );
      if (member.rowCount) return { error: "This email already has a membership in this workspace", status: 409 } as const;

      const insert = await client.query<{ id: string }>(
        `INSERT INTO invitations (company_id, email, role, scope, team_ids, invited_by, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '7 days')
         RETURNING id, email, role, scope, state, expires_at, created_at`,
        [companyId, email, role, scope, teamIds, inviterId, hashToken(token)]
      );
      const invitation = insert.rows[0];
      await client.query(
        `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
         VALUES ($1, $2, 'invitation.created', 'invitation', $3, $4)`,
        [companyId, inviterId, invitation.id, JSON.stringify({ email, role })]
      );
      return { invitation };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    if (!(await deliver("invitation", email, token))) {
      await query(`UPDATE invitations SET state = 'revoked', revoked_at = now() WHERE id = $1 AND state = 'pending'`, [result.invitation.id]);
      return NextResponse.json({ error: "The invitation email could not be sent. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ invitation: result.invitation }, { status: 201 });
  } catch {
    console.error("Invitation could not be created");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
