import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase().trim();

    // Always return success to prevent email enumeration
    const userResult = await query(
      `SELECT id FROM user_profiles WHERE LOWER(email) = $1`,
      [emailLower]
    );

    if (userResult.rows.length > 0) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await query(
        `UPDATE user_profiles SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3`,
        [tokenHash, expires.toISOString(), userResult.rows[0].id]
      );

      // In production, send email. For dev, log it.
      console.log(`[DEV] Password reset token for ${emailLower}: ${token}`);
      console.log(`[DEV] Reset URL: ${process.env.NEXTAUTH_URL}/reset-password?token=${token}`);
    }

    return NextResponse.json({
      message:
        "If an account exists with that email, a password reset link has been sent",
    });
  } catch (error: unknown) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
