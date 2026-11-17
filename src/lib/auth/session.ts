import { query } from "@/lib/db";
import crypto from "crypto";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";

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
  const credentials = await storeSession(userId);
  await setSessionCookies(credentials, companyId);
  return credentials.token;
}

export async function storeSession(userId: string, client?: PoolClient) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  );

  const sql = `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`;
  const params = [userId, tokenHash, expiresAt.toISOString()];
  if (client) await client.query(sql, params);
  else await query(sql, params);
  return { token, expiresAt };
}

export async function setSessionCookies(
  { token, expiresAt }: { token: string; expiresAt: Date },
  companyId?: string
) {
  const cookieStore = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };

  cookieStore.set(SESSION_COOKIE, token, options);
  if (companyId) {
    cookieStore.set("komatsu_company", companyId, options);
  }
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

  // Clear the browser credentials first so logout still takes effect locally if
  // the database is temporarily unavailable while revoking the server session.
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete("komatsu_company");

  if (token) {
    const tokenHash = hashToken(token);
    await query(`DELETE FROM sessions WHERE token = $1`, [tokenHash]);
  }
}
