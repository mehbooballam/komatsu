import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { validateSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { getAuth, createAuditEvent } from "@/lib/auth-helpers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * PATCH /api/users/me/profile { display_name?, email?, current_password? }
 * Changing the email requires the current password.
 */
export async function PATCH(request: Request) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    display_name?: string;
    email?: string;
    current_password?: string;
  };

  const userRes = await query(`SELECT id, email, display_name, password_hash FROM user_profiles WHERE id = $1`, [session.userId]);
  const user = userRes.rows[0];
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updates: string[] = [];
  const values: unknown[] = [];
  const changed: Record<string, string> = {};

  if (body.display_name !== undefined) {
    const name = body.display_name.trim();
    if (name.length < 2 || name.length > 80) {
      return NextResponse.json({ error: "Name must be 2–80 characters" }, { status: 400 });
    }
    if (name !== user.display_name) {
      values.push(name);
      updates.push(`display_name = $${values.length}`);
      changed.display_name = name;
    }
  }

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (email !== String(user.email).toLowerCase()) {
      if (!body.current_password) {
        return NextResponse.json({ error: "Enter your current password to change your email", field: "current_password" }, { status: 400 });
      }
      if (!user.password_hash || !(await verifyPassword(body.current_password, user.password_hash))) {
        return NextResponse.json({ error: "Current password is incorrect", field: "current_password" }, { status: 400 });
      }
      const taken = await query(`SELECT 1 FROM user_profiles WHERE LOWER(email) = $1 AND id <> $2`, [email, user.id]);
      if (taken.rows.length > 0) {
        return NextResponse.json({ error: "That email is already used by another account", field: "email" }, { status: 409 });
      }
      values.push(email);
      updates.push(`email = $${values.length}`);
      changed.email = email;
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ user: { id: user.id, email: user.email, display_name: user.display_name }, unchanged: true });
  }

  values.push(user.id);
  const res = await query(
    `UPDATE user_profiles SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, email, display_name`,
    values
  );

  const auth = await getAuth();
  if (auth) {
    await createAuditEvent(auth.company_id, auth.membership_id, "profile_updated", "user", user.id,
      { display_name: user.display_name, email: user.email }, changed);
  }

  return NextResponse.json({ user: res.rows[0] });
}
