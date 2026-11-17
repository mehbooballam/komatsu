import { query } from "@/lib/db";
import crypto from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "komatsu_session";
const SESSION_EXPIRY_DAYS = 7;

export function generateToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  companyId?: string
): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  );

  await query(
    `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt.toISOString()]
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  if (companyId) {
    cookieStore.set("komatsu_company", companyId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }

  return token;
}

export interface SessionData {
  sessionId: string;
  userId: string;
}

export async function validateSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const result = await query(
    `SELECT id, user_id FROM sessions WHERE token = $1 AND expires_at > now()`,
    [tokenHash]
  );

  if (result.rows.length === 0) return null;

  await query(`UPDATE sessions SET last_active_at = now() WHERE id = $1`, [
    result.rows[0].id,
  ]);

  return {
    sessionId: result.rows[0].id,
    userId: result.rows[0].user_id,
  };
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = hashToken(token);
    await query(`DELETE FROM sessions WHERE token = $1`, [tokenHash]);
  }

  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete("komatsu_company");
}

export async function destroyAllUserSessions(userId: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}
