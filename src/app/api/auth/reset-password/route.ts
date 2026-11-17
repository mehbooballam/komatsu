import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { destroyAllUserSessions } from "@/lib/auth/session";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json(
        { error: "Token and new password are required" },
        { status: 400 }
      );
    }

    const pwError = validatePasswordStrength(password);
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const result = await query(
      `SELECT id FROM user_profiles
       WHERE password_reset_token = $1 AND password_reset_expires > now()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    const userId = result.rows[0].id;
    const newHash = await hashPassword(password);

    await query(
      `UPDATE user_profiles
       SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL
       WHERE id = $2`,
      [newHash, userId]
    );

    await destroyAllUserSessions(userId);

    return NextResponse.json({
      message: "Password has been reset. Please sign in with your new password.",
    });
  } catch (error: unknown) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
