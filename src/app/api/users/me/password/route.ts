import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { validateSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/lib/auth/password";
import { getAuth, createAuditEvent } from "@/lib/auth-helpers";

/**
 * POST /api/users/me/password { current_password, new_password }
 * Changes the password and signs out every other session (this one stays signed in).
 */
export async function POST(request: Request) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { current_password, new_password } = (await request.json().catch(() => ({}))) as {
    current_password?: string;
    new_password?: string;
  };
  if (!current_password || !new_password) {
    return NextResponse.json({ error: "Enter your current and new password" }, { status: 400 });
  }

  const userRes = await query(`SELECT id, password_hash FROM user_profiles WHERE id = $1`, [session.userId]);
  const user = userRes.rows[0];
  if (!user?.password_hash || !(await verifyPassword(current_password, user.password_hash))) {
    return NextResponse.json({ error: "Current password is incorrect", field: "current_password" }, { status: 400 });
  }

  const weak = validatePasswordStrength(new_password);
  if (weak) return NextResponse.json({ error: weak, field: "new_password" }, { status: 400 });
  if (await verifyPassword(new_password, user.password_hash)) {
    return NextResponse.json({ error: "New password must be different from the current one", field: "new_password" }, { status: 400 });
  }

  const hash = await hashPassword(new_password);
  await query(
    `UPDATE user_profiles SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2`,
    [hash, user.id]
  );
  // Sign out other devices
  const ended = await query(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [user.id, session.sessionId]);

  const auth = await getAuth();
  if (auth) {
    await createAuditEvent(auth.company_id, auth.membership_id, "password_changed", "user", user.id, null, {
      other_sessions_ended: ended.rowCount ?? 0,
    });
  }

  return NextResponse.json({ success: true, other_sessions_ended: ended.rowCount ?? 0 });
}
