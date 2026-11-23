import { NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { getServerSession } from "@/lib/auth/middleware";
import { canInviteUsers } from "@/lib/auth/permissions";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canInviteUsers(session.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }
    const revoked = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE invitations SET state = 'revoked', revoked_at = now()
         WHERE id = $1 AND company_id = $2 AND state = 'pending'
           AND ($3 = 'company_admin' OR role IN ('reviewer', 'risk_owner'))
         RETURNING id`,
        [id, session.company.id, session.membership.role]
      );
      if (!result.rowCount) return false;
      await client.query(
        `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id)
         VALUES ($1, $2, 'invitation.revoked', 'invitation', $3)`,
        [session.company.id, session.membership.id, id]
      );
      return true;
    });

    if (!revoked) {
      return NextResponse.json(
        { error: "Invitation not found or already used" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Revoke invitation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
