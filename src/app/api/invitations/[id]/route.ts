import { NextResponse } from "next/server";
import { query } from "@/lib/db";
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

    const result = await query(
      `UPDATE invitations SET state = 'revoked', revoked_at = now()
       WHERE id = $1 AND company_id = $2 AND state = 'pending'
       RETURNING id`,
      [id, session.company.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Invitation not found or already used" },
        { status: 404 }
      );
    }

    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id)
       VALUES ($1, $2, 'invitation.revoked', 'invitation', $3)`,
      [session.company.id, session.membership.id, id]
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Revoke invitation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
