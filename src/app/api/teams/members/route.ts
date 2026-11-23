import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { canAssign, canImport, getAuth, unauthorized, forbidden } from "@/lib/auth-helpers";
import { parseEmailAddress } from "@/lib/auth/email-address";
import { canGrantInvitationRole, isInvitationRole } from "@/lib/auth/invitation-policy";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import type { AuthMembership } from "@/lib/auth/middleware";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST { display_name, email, role, password, scope?, team_ids? }
 * Sets up a member directly (no invitation email). A new account gets the password given;
 * an email that already has an account elsewhere is simply added to this workspace
 * (its password is not changed). Same role rules as invitations.
 */
export async function POST(request: Request) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();

  const body = await request.json().catch(() => null);
  const email = parseEmailAddress(body?.email);
  const role = body?.role;
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim().slice(0, 120) : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !isInvitationRole(role)) return NextResponse.json({ error: "A valid email and role are required" }, { status: 400 });
  if (!canGrantInvitationRole(auth.role as AuthMembership["role"], role)) {
    return NextResponse.json({ error: "You cannot set up users with that role" }, { status: 403 });
  }
  const scope = body?.scope ?? (role === "risk_owner" ? "assigned" : "company");
  if (!["company", "team", "assigned"].includes(scope)) return NextResponse.json({ error: "Invalid access scope" }, { status: 400 });
  const requested: unknown = body?.team_ids ?? [];
  if (!Array.isArray(requested) || requested.length > 100 || requested.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return NextResponse.json({ error: "Invalid teams" }, { status: 400 });
  }
  const teamIds = [...new Set((requested as string[]).map((id) => id.toLowerCase()))];

  const result = await transaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [auth.company_id, email]);
    const teams = await client.query(`SELECT id FROM teams WHERE company_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`, [auth.company_id, teamIds]);
    if (teams.rowCount !== teamIds.length) return { error: "Teams must belong to this workspace", status: 400 } as const;

    const existing = await client.query<{ id: string }>(`SELECT id FROM user_profiles WHERE LOWER(email) = $1 FOR UPDATE`, [email]);
    let userId = existing.rows[0]?.id;
    let created = false;
    if (userId) {
      const member = await client.query(`SELECT state FROM memberships WHERE company_id = $1 AND user_id = $2`, [auth.company_id, userId]);
      if (member.rows[0]?.state === "active") return { error: "This person is already a member of this workspace", status: 409 } as const;
      if (member.rows[0]) {
        // Revoked earlier: give access again with the new role
        await client.query(
          `UPDATE memberships SET state = 'active', role = $3, access_scope = $4, revoked_at = NULL WHERE company_id = $1 AND user_id = $2`,
          [auth.company_id, userId, role, scope]
        );
      }
    } else {
      if (!displayName) return { error: "Enter the person's name", status: 400 } as const;
      const pwError = validatePasswordStrength(password);
      if (pwError) return { error: pwError, status: 400 } as const;
      const ins = await client.query<{ id: string }>(
        `INSERT INTO user_profiles (email, password_hash, display_name, verified_email) VALUES ($1, $2, $3, TRUE) RETURNING id`,
        [email, await hashPassword(password), displayName]
      );
      userId = ins.rows[0].id;
      created = true;
    }

    const m = await client.query<{ id: string }>(
      `INSERT INTO memberships (company_id, user_id, role, access_scope, state) VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (company_id, user_id) DO UPDATE SET state = 'active' RETURNING id`,
      [auth.company_id, userId, role, scope]
    );
    const membershipId = m.rows[0].id;
    if (teamIds.length) {
      await client.query(
        `INSERT INTO team_memberships (company_id, team_id, membership_id) SELECT $1, id, $2 FROM teams WHERE company_id = $1 AND id = ANY($3::uuid[]) ON CONFLICT DO NOTHING`,
        [auth.company_id, membershipId, teamIds]
      );
    }
    // Pending invitations for this email are no longer needed
    await client.query(
      `UPDATE invitations SET state = 'revoked', revoked_at = now() WHERE company_id = $1 AND LOWER(email) = $2 AND state = 'pending'`,
      [auth.company_id, email]
    );
    await client.query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
       VALUES ($1, $2, 'member.created', 'membership', $3, $4)`,
      [auth.company_id, auth.membership_id, membershipId, JSON.stringify({ email, role, name: displayName || null, new_account: created })]
    );
    return { membershipId, created } as const;
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ membership_id: result.membershipId, new_account: result.created }, { status: 201 });
}

export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canAssign(auth.role)) return forbidden();

  const result = await query(
    `SELECT m.id, m.role, m.access_scope, m.state, m.joined_at,
            up.display_name, up.email, up.preferences->>'avatar' AS avatar
     FROM memberships m
     JOIN user_profiles up ON up.id = m.user_id
     WHERE m.company_id = $1 AND m.state = 'active'
     ORDER BY up.display_name`,
    [auth.company_id]
  );

  return NextResponse.json({ members: result.rows });
}
