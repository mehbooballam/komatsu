import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import crypto from "crypto";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  try {
    if (!token) {
      return NextResponse.json(
        { error: "Verification token is required" },
        { status: 400 }
      );
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const result = await query(
      `SELECT id FROM user_profiles
       WHERE email_verification_token = $1 AND email_verification_expires > now()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid or expired verification token" },
        { status: 400 }
      );
    }

    await query(
      `UPDATE user_profiles
       SET verified_email = TRUE, email_verification_token = NULL, email_verification_expires = NULL
       WHERE id = $1`,
      [result.rows[0].id]
    );

    return NextResponse.json({
      message: "Email verified successfully. You can now sign in.",
    });
  } catch (error: unknown) {
    console.error("Verify email error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
