import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { token, password } = body ?? {};
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || typeof password !== "string") {
    return NextResponse.json({ error: "A valid reset token and new password are required" }, { status: 400 });
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  try {
    const tokenHash = hashToken(token);
    // Check before hashing to keep invalid requests from spending bcrypt work.
    const valid = await query(
      `SELECT 1 FROM user_profiles WHERE password_reset_token = $1 AND password_reset_expires > now()`,
      [tokenHash]
    );
    if (!valid.rowCount) {
      return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const reset = await transaction(async (client) => {
      const row = await client.query<{ id: string }>(
        `UPDATE user_profiles SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL
         WHERE password_reset_token = $2 AND password_reset_expires > now()
         RETURNING id`,
        [passwordHash, tokenHash]
      );
      if (!row.rows[0]) return false;
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [row.rows[0].id]);
      return true;
    });
    if (!reset) return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });

    return NextResponse.json({ message: "Password has been reset. Please sign in with your new password." });
  } catch {
    console.error("Password reset could not be completed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
