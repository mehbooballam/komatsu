import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, getAuth, unauthorized, forbidden } from "@/lib/auth-helpers";
import { canGrantInvitationRole } from "@/lib/auth/invitation-policy";
import type { AuthMembership } from "@/lib/auth/middleware";

/** DELETE — revoke a member's access to this workspace (the account itself stays). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const res = await query(
    `SELECT m.id, m.role, m.state, up.email, up.display_name FROM memberships m JOIN user_profiles up ON up.id = m.user_id
     WHERE m.id = $1 AND m.company_id = $2`,
    [id, auth.company_id]
  );
  const member = res.rows[0];
  if (!member || member.state !== "active") return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (member.id === auth.membership_id) return NextResponse.json({ error: "You can't revoke your own access" }, { status: 400 });
  if (!canGrantInvitationRole(auth.role as AuthMembership["role"], member.role)) {
    return NextResponse.json({ error: "You can't revoke a member with that role" }, { status: 403 });
  }
  if (member.role === "company_admin") {
    const admins = await query(`SELECT COUNT(*)::int AS n FROM memberships WHERE company_id = $1 AND role = 'company_admin' AND state = 'active'`, [auth.company_id]);
    if (admins.rows[0].n <= 1) return NextResponse.json({ error: "The workspace needs at least one administrator" }, { status: 400 });
  }

  await query(`UPDATE memberships SET state = 'revoked', revoked_at = now() WHERE id = $1 AND company_id = $2`, [id, auth.company_id]);
  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values)
     VALUES ($1, $2, 'member.revoked', 'membership', $3, $4)`,
    [auth.company_id, auth.membership_id, id, JSON.stringify({ email: member.email, name: member.display_name, role: member.role })]
  );
  return NextResponse.json({ ok: true });
}
