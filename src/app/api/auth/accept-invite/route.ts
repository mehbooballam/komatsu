import { NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { parseEmailAddress } from "@/lib/auth/email-address";
import { canGrantInvitationRole } from "@/lib/auth/invitation-policy";
import type { AuthMembership } from "@/lib/auth/middleware";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { hashToken, setSessionCookies, storeSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const email = parseEmailAddress(body?.email);
  const password = body?.password;
  const mode = body?.mode;
  const rawDisplayName = body?.displayName ?? body?.display_name;
  const displayName = typeof rawDisplayName === "string" ? rawDisplayName.trim() : "";
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || !email || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "A valid invitation, email, and password are required" }, { status: 400 });
  }
  if (mode !== undefined && mode !== "existing" && mode !== "new") {
    return NextResponse.json({ error: "Invalid account type" }, { status: 400 });
  }

  try {
    const result = await transaction(async (client) => {
      const invitationResult = await client.query<{
        id: string;
        company_id: string;
        role: AuthMembership["role"];
        scope: AuthMembership["access_scope"];
        team_ids: string[] | null;
        inviter_role: AuthMembership["role"];
      }>(
        `SELECT i.id, i.company_id, i.role, i.scope, i.team_ids, inviter.role AS inviter_role
         FROM invitations i
         JOIN memberships inviter ON inviter.id = i.invited_by AND inviter.company_id = i.company_id
         JOIN companies c ON c.id = i.company_id
         WHERE i.token_hash = $1 AND LOWER(i.email) = $2
           AND i.state = 'pending' AND i.expires_at > now()
           AND inviter.state = 'active' AND c.archived_at IS NULL
         FOR UPDATE OF i FOR SHARE OF inviter, c`,
        [hashToken(token), email]
      );
      const invitation = invitationResult.rows[0];
      if (!invitation || !canGrantInvitationRole(invitation.inviter_role, invitation.role)) {
        return { error: "Invalid or expired invitation", status: 400 } as const;
      }

      const userResult = await client.query<{ id: string; password_hash: string | null; verified_email: boolean }>(
        `SELECT id, password_hash, verified_email FROM user_profiles WHERE LOWER(email) = $1 FOR UPDATE`,
        [email]
      );
      const user = userResult.rows[0];
      let userId: string;
      if (user) {
        if (mode === "new") return { error: "Use Existing account to sign in with this email", status: 409 } as const;
        if (!user.password_hash || !(await verifyPassword(password, user.password_hash))) {
          return { error: "Invalid email or password", status: 401 } as const;
        }
        if (!user.verified_email) {
          return { error: "Verify your email before joining", status: 403 } as const;
        }
        userId = user.id;
      } else {
        if (mode === "existing") return { error: "Invalid email or password", status: 401 } as const;
        if (!displayName) return { error: "Display name is required for a new account", status: 400 } as const;
        const passwordError = validatePasswordStrength(password);
        if (passwordError) return { error: passwordError, status: 400 } as const;

        const newUser = await client.query<{ id: string }>(
          `INSERT INTO user_profiles (email, password_hash, display_name, verified_email)
           VALUES ($1, $2, $3, TRUE) ON CONFLICT DO NOTHING RETURNING id`,
          [email, await hashPassword(password), displayName]
        );
        if (!newUser.rows[0]) {
          return { error: "Use Existing account to sign in with this email", status: 409 } as const;
        }
        userId = newUser.rows[0].id;
      }

      const membership = await client.query<{ id: string }>(
        `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
         VALUES ($1, $2, $3, $4, 'active') ON CONFLICT (company_id, user_id) DO NOTHING RETURNING id`,
        [invitation.company_id, userId, invitation.role, invitation.scope]
      );
      const membershipId = membership.rows[0]?.id;
      if (!membershipId) {
        return { error: "A membership already exists. Contact a workspace administrator for access.", status: 409 } as const;
      }

      if (invitation.team_ids?.length) {
        await client.query(
          `INSERT INTO team_memberships (company_id, team_id, membership_id)
           SELECT $1, id, $2 FROM teams WHERE company_id = $1 AND archived_at IS NULL AND id = ANY($3::uuid[])
           ON CONFLICT DO NOTHING`,
          [invitation.company_id, membershipId, invitation.team_ids]
        );
      }

      await client.query(`UPDATE invitations SET state = 'accepted', used_at = now() WHERE id = $1`, [invitation.id]);
      await client.query(
        `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
         VALUES ($1, $2, 'invitation.accepted', 'invitation', $3, $4)`,
        [invitation.company_id, membershipId, invitation.id, JSON.stringify({ email, role: invitation.role })]
      );
      const credentials = await storeSession(userId, client);
      return { companyId: invitation.company_id, role: invitation.role, scope: invitation.scope, membershipId, credentials };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    await setSessionCookies(result.credentials, result.companyId);
    return NextResponse.json({
      message: "Invitation accepted",
      membership: { id: result.membershipId, companyId: result.companyId, role: result.role, accessScope: result.scope },
    }, { status: 201 });
  } catch (error: unknown) {
    console.error("Accept invitation error", { code: (error as { code?: string }).code });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
