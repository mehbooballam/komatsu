import { randomBytes } from "node:crypto";
import { after, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAccountMailer } from "@/lib/auth/account-email";
import { parseEmailAddress } from "@/lib/auth/email-address";
import { hashToken } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = parseEmailAddress(body?.email);
  if (!email) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });

  const deliver = getAccountMailer();
  if (!deliver) {
    return NextResponse.json({ error: "Password reset email is not configured. Contact support for help." }, { status: 503 });
  }

  // Perform account lookup and delivery after the response to keep the timing independent of account existence.
  after(async () => {
    try {
      const token = randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      // Repeated requests cannot invalidate a just-issued link or send back-to-back emails.
      const updated = await query(
        `UPDATE user_profiles
         SET password_reset_token = $1, password_reset_expires = now() + interval '1 hour'
         WHERE LOWER(email) = $2
           AND (password_reset_expires IS NULL OR password_reset_expires <= now() + interval '59 minutes')`,
        [tokenHash, email]
      );

      if (updated.rowCount && !(await deliver("password-reset", email, token))) {
        await query(
          `UPDATE user_profiles SET password_reset_token = NULL, password_reset_expires = NULL
           WHERE LOWER(email) = $1 AND password_reset_token = $2`,
          [email, tokenHash]
        );
      }
    } catch {
      console.error("Password reset request could not be processed");
    }
  });

  return NextResponse.json({ message: "If an account exists with that email, you will receive a password reset link" });
}
